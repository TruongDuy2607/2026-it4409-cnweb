const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Role = require("../models/Role");
const { authenticate, requirePermission } = require("../middleware/auth");
const { loadUser, loadRole } = require("../middleware/loaders");
const { missingPermissions, isLastSuperAdmin } = require("../utils/rbac");
const { fail, detail, notAllowedFields, isPlainObject, isObjectId, parsePaging, parseSort, escapeRegex, pageMeta, userView, roleSummary } = require("../utils/http");
const { isString, checkEmail, checkFullName, checkPhone, checkPassword } = require("../utils/validate");

const router = express.Router();
router.use(authenticate); // mọi endpoint dưới đây đều cần đăng nhập

const sameId = (a, b) => String(a) === String(b);
const VALIDATION_MSG = "Dữ liệu đầu vào không hợp lệ.";
// Sắp xếp theo thứ tự chữ cái tiếng Việt thay vì thứ tự mã Unicode
const VI_COLLATION = { locale: "vi", strength: 2 };

// U1: danh sách người dùng
router.get("/", requirePermission("users:read"), async (req, res) => {
  const q = req.query;
  const details = [];
  const { page, limit } = parsePaging(q, details);
  let sort = parseSort(q.sort ?? "-createdAt", ["fullName", "email", "createdAt", "lastLoginAt"], details);
  if (!Object.keys(sort).length) sort = { createdAt: -1 };
  if (q.status !== undefined && !["active", "locked"].includes(q.status))
    details.push(detail("status", "INVALID_VALUE", "status phải là active hoặc locked."));
  if (q.roleId !== undefined && !isObjectId(q.roleId)) details.push(detail("roleId", "INVALID_VALUE", "roleId phải là ObjectId hợp lệ."));
  if (q.q !== undefined && (!isString(q.q) || q.q.trim().length < 2)) details.push(detail("q", "TOO_SHORT", "q phải có ít nhất 2 ký tự."));
  if (details.length) return fail(res, 400, "INVALID_QUERY_PARAMETER", "Tham số truy vấn không hợp lệ.", details);

  const filter = { status: q.status || { $ne: "deleted" } };
  if (q.roleId) filter.roles = q.roleId; // với trường mảng, MongoDB khớp khi mảng chứa giá trị
  if (q.q) {
    const re = { $regex: escapeRegex(q.q.trim()), $options: "i" };
    filter.$or = [{ fullName: re }, { email: re }];
  }

  // _id được thêm vào cuối khóa sắp xếp để thứ tự ổn định giữa các trang
  const [items, totalItems] = await Promise.all([
    User.find(filter).sort({ ...sort, _id: 1 }).collation(VI_COLLATION).skip((page - 1) * limit).limit(limit).populate("roles"),
    User.countDocuments(filter),
  ]);
  res.json({ data: items.map(userView), meta: pageMeta(page, limit, totalItems) });
});

// U2: tạo người dùng
router.post("/", requirePermission("users:create"), async (req, res) => {
  const body = req.body;
  if (!isPlainObject(body)) return fail(res, 400, "VALIDATION_ERROR", "Body phải là một đối tượng JSON.");

  // 1. Allow-list và kiểm tra từng trường
  const details = notAllowedFields(body, ["email", "fullName", "phone", "password", "roleIds"]);
  checkEmail(body.email, details);
  checkFullName(body.fullName, details);
  checkPhone(body.phone, details);
  checkPassword(body.password, details);
  if (body.roleIds !== undefined && (!Array.isArray(body.roleIds) || !body.roleIds.every(isObjectId)))
    details.push(detail("roleIds", "INVALID_VALUE", "roleIds phải là mảng ObjectId hợp lệ."));
  if (details.length) return fail(res, 400, "VALIDATION_ERROR", VALIDATION_MSG, details);

  // 2. Vai trò: có roleIds thì cần roles:assign, mọi vai trò phải tồn tại và không vượt quyền người gọi
  let roles = [];
  const roleIds = [...new Set(body.roleIds || [])];
  if (roleIds.length) {
    if (!req.permissions.has("roles:assign")) return fail(res, 403, "FORBIDDEN", "Gán vai trò khi tạo người dùng cần quyền roles:assign.");
    roles = await Role.find({ _id: { $in: roleIds } });
    if (roles.length !== roleIds.length) return fail(res, 400, "ROLE_NOT_FOUND", "Có vai trò không tồn tại trong roleIds.");
    for (const r of roles) {
      const missing = missingPermissions(r.permissions, req.permissions);
      if (missing.length)
        return fail(res, 403, "PRIVILEGE_ESCALATION", `Không thể gán vai trò '${r.code}' vì bạn không có quyền: ${missing.join(", ")}.`);
    }
  } else {
    roles = await Role.find({ code: "member" }); // vai trò mặc định
  }

  // 3. Email trùng, kể cả tài khoản đã xóa mềm (BR-01)
  const email = body.email.trim().toLowerCase();
  if (await User.exists({ email })) return fail(res, 409, "EMAIL_ALREADY_EXISTS", "Email đã được sử dụng.");

  // 4. Tạo mới
  const user = await User.create({
    email,
    fullName: body.fullName,
    phone: body.phone ?? null,
    passwordHash: await bcrypt.hash(body.password, 10),
    roles: roles.map((r) => r._id),
  });
  await user.populate("roles");
  res.status(201).location(`${req.baseUrl}/${user._id}`).json(userView(user));
});

// U3: chi tiết
router.get("/:userId", requirePermission("users:read"), loadUser, (req, res) => res.json(userView(req.target)));

// U4: cập nhật một phần, gồm khóa và mở khóa
router.patch("/:userId", requirePermission("users:update"), loadUser, async (req, res) => {
  const body = req.body;
  if (!isPlainObject(body)) return fail(res, 400, "VALIDATION_ERROR", "Body phải là một đối tượng JSON.");

  const details = notAllowedFields(body, ["fullName", "phone", "email", "status"]);
  if (!Object.keys(body).length) details.push(detail("body", "EMPTY_BODY", "Cần gửi ít nhất một trường cần cập nhật."));
  if ("fullName" in body) checkFullName(body.fullName, details);
  if ("phone" in body) checkPhone(body.phone, details);
  if ("email" in body) checkEmail(body.email, details);
  if ("status" in body && !["active", "locked"].includes(body.status))
    details.push(detail("status", "INVALID_VALUE", "status phải là active hoặc locked."));
  if (details.length) return fail(res, 400, "VALIDATION_ERROR", VALIDATION_MSG, details);

  const user = req.target;
  if (body.status === "locked" && user.status !== "locked") {
    if (sameId(user._id, req.user._id)) return fail(res, 403, "SELF_ACTION_FORBIDDEN", "Bạn không thể tự khóa tài khoản của mình.");
    if (await isLastSuperAdmin(user)) return fail(res, 409, "LAST_SUPER_ADMIN", "Không thể khóa super-admin đang hoạt động cuối cùng.");
  }
  if ("email" in body) {
    const email = body.email.trim().toLowerCase();
    if (email !== user.email && (await User.exists({ email, _id: { $ne: user._id } })))
      return fail(res, 409, "EMAIL_ALREADY_EXISTS", "Email đã được sử dụng.");
  }

  // Chỉ gán các trường có trong body, trường không gửi giữ nguyên
  for (const k of ["fullName", "phone", "email", "status"]) if (k in body) user[k] = body[k];
  await user.save(); // save() chạy lại validator của schema
  res.json(userView(user));
});

// U5: xóa mềm
router.delete("/:userId", requirePermission("users:delete"), loadUser, async (req, res) => {
  const user = req.target;
  if (sameId(user._id, req.user._id)) return fail(res, 403, "SELF_ACTION_FORBIDDEN", "Bạn không thể tự xóa tài khoản của mình.");
  if (await isLastSuperAdmin(user)) return fail(res, 409, "LAST_SUPER_ADMIN", "Không thể xóa super-admin đang hoạt động cuối cùng.");
  user.status = "deleted";
  await user.save();
  res.status(204).end();
});

// UR1: vai trò của người dùng
router.get("/:userId/roles", requirePermission("users:read"), loadUser, (req, res) => {
  const data = req.target.roles.filter(Boolean).map(roleSummary);
  res.json({ data, meta: { totalItems: data.length } });
});

// UR2: gán vai trò, idempotent
router.put("/:userId/roles/:roleId", requirePermission("roles:assign"), loadUser, loadRole, async (req, res) => {
  const missing = missingPermissions(req.role.permissions, req.permissions);
  if (missing.length)
    return fail(res, 403, "PRIVILEGE_ESCALATION", `Không thể gán vai trò '${req.role.code}' vì bạn không có quyền: ${missing.join(", ")}.`);
  await User.updateOne({ _id: req.target._id }, { $addToSet: { roles: req.role._id } }); // không tạo bản ghi trùng
  res.status(204).end();
});

// UR3: gỡ vai trò, idempotent
router.delete("/:userId/roles/:roleId", requirePermission("roles:assign"), loadUser, loadRole, async (req, res) => {
  if (sameId(req.target._id, req.user._id)) return fail(res, 403, "SELF_ACTION_FORBIDDEN", "Bạn không thể tự gỡ vai trò của mình.");
  const missing = missingPermissions(req.role.permissions, req.permissions);
  if (missing.length)
    return fail(res, 403, "PRIVILEGE_ESCALATION", `Không thể gỡ vai trò '${req.role.code}' vì bạn không có quyền: ${missing.join(", ")}.`);
  if (await isLastSuperAdmin(req.target, req.role._id))
    return fail(res, 409, "LAST_SUPER_ADMIN", "Không thể gỡ vai trò super-admin của người dùng cuối cùng còn hoạt động.");
  await User.updateOne({ _id: req.target._id }, { $pull: { roles: req.role._id } });
  res.status(204).end();
});

// Mở rộng: quyền hiệu lực của người dùng kèm vai trò là nguồn gốc của từng quyền
router.get("/:userId/permissions", requirePermission("users:read"), loadUser, (req, res) => {
  const sources = new Map();
  for (const r of req.target.roles.filter(Boolean))
    for (const p of r.permissions) sources.set(p, [...(sources.get(p) || []), roleSummary(r)]);
  const data = [...sources.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([code, from]) => ({ code, sources: from }));
  res.json({ data, meta: { totalItems: data.length } });
});

module.exports = router;
