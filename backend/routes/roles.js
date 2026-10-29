const express = require("express");
const Role = require("../models/Role");
const User = require("../models/User");
const Permission = require("../models/Permission");
const { authenticate, requirePermission } = require("../middleware/auth");
const { loadRole } = require("../middleware/loaders");
const { missingPermissions } = require("../utils/rbac");
const { fail, detail, notAllowedFields, isPlainObject, parsePaging, parseSort, escapeRegex, pageMeta, roleView, userView, permissionView } = require("../utils/http");
const { isString, ROLE_CODE_RE } = require("../utils/validate");

const router = express.Router();
router.use(authenticate);

const VALIDATION_MSG = "Dữ liệu đầu vào không hợp lệ.";
const VI_COLLATION = { locale: "vi", strength: 2 };

// Số người dùng chưa bị xóa đang mang vai trò
const countUsers = (roleId) => User.countDocuments({ roles: roleId, status: { $ne: "deleted" } });

// Đếm người dùng cho nhiều vai trò bằng một truy vấn aggregate, tránh N+1 truy vấn khi liệt kê
async function countUsersByRole(roleIds) {
  if (!roleIds.length) return new Map();
  const rows = await User.aggregate([
    { $match: { status: { $ne: "deleted" }, roles: { $in: roleIds } } },
    { $unwind: "$roles" },
    { $match: { roles: { $in: roleIds } } },
    { $group: { _id: "$roles", n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.n]));
}

// Kiểm tra mảng mã quyền: đúng kiểu và tồn tại trong danh mục. Trả về null nếu hợp lệ.
async function checkPermissionList(perms) {
  if (!Array.isArray(perms) || !perms.every((p) => typeof p === "string"))
    return { status: 400, code: "VALIDATION_ERROR", details: [detail("permissions", "INVALID_TYPE", "permissions phải là mảng mã quyền.")] };
  const known = new Set((await Permission.find({ code: { $in: perms } })).map((p) => p.code));
  const unknown = [...new Set(perms.filter((p) => !known.has(p)))];
  if (unknown.length)
    return { status: 400, code: "PERMISSION_NOT_FOUND", details: unknown.map((p) => detail("permissions", "NOT_FOUND", `Quyền '${p}' không tồn tại.`)) };
  return null;
}

const sendCheck = (res, check) => fail(res, check.status, check.code, check.code === "PERMISSION_NOT_FOUND" ? "Danh sách quyền chứa mã không tồn tại." : VALIDATION_MSG, check.details);

// R1: danh sách vai trò
router.get("/", requirePermission("roles:read"), async (req, res) => {
  const q = req.query;
  const details = [];
  const { page, limit } = parsePaging(q, details);
  let sort = parseSort(q.sort ?? "name", ["name", "code", "createdAt"], details);
  if (!Object.keys(sort).length) sort = { name: 1 };
  if (q.q !== undefined && (!isString(q.q) || !q.q.trim())) details.push(detail("q", "INVALID_VALUE", "q phải là chuỗi không rỗng."));
  if (details.length) return fail(res, 400, "INVALID_QUERY_PARAMETER", "Tham số truy vấn không hợp lệ.", details);

  const filter = {};
  if (q.q) {
    const re = { $regex: escapeRegex(q.q.trim()), $options: "i" };
    filter.$or = [{ name: re }, { code: re }];
  }
  const [items, totalItems] = await Promise.all([
    Role.find(filter).sort({ ...sort, _id: 1 }).collation(VI_COLLATION).skip((page - 1) * limit).limit(limit),
    Role.countDocuments(filter),
  ]);
  const counts = await countUsersByRole(items.map((r) => r._id));
  res.json({ data: items.map((r) => roleView(r, counts.get(String(r._id)) || 0)), meta: pageMeta(page, limit, totalItems) });
});

// R2: tạo vai trò
router.post("/", requirePermission("roles:create"), async (req, res) => {
  const body = req.body;
  if (!isPlainObject(body)) return fail(res, 400, "VALIDATION_ERROR", "Body phải là một đối tượng JSON.");

  const details = notAllowedFields(body, ["code", "name", "description", "permissions"]);
  if (!isString(body.code) || !body.code) details.push(detail("code", "REQUIRED", "Mã vai trò không được để trống."));
  else if (!ROLE_CODE_RE.test(body.code.trim())) details.push(detail("code", "INVALID_VALUE", "Mã vai trò gồm chữ thường, số, gạch nối, dài 3 đến 50 ký tự và bắt đầu bằng chữ."));
  if (!isString(body.name) || !body.name.trim()) details.push(detail("name", "REQUIRED", "Tên vai trò không được để trống."));
  else if (body.name.trim().length < 2 || body.name.trim().length > 100) details.push(detail("name", "INVALID_VALUE", "Tên vai trò phải dài từ 2 đến 100 ký tự."));
  if (body.description !== undefined && body.description !== null && (!isString(body.description) || body.description.trim().length > 500))
    details.push(detail("description", "INVALID_VALUE", "Mô tả phải là chuỗi tối đa 500 ký tự."));
  if (details.length) return fail(res, 400, "VALIDATION_ERROR", VALIDATION_MSG, details);

  const permissions = body.permissions === undefined ? [] : body.permissions;
  const check = await checkPermissionList(permissions);
  if (check) return sendCheck(res, check);

  // Chống leo thang đặc quyền: mọi quyền cấp cho vai trò mới phải nằm trong quyền của người gọi
  const missing = missingPermissions(permissions, req.permissions);
  if (missing.length) return fail(res, 403, "PRIVILEGE_ESCALATION", `Không thể cấp các quyền mà bạn không có: ${missing.join(", ")}.`);

  const code = body.code.trim();
  if (await Role.exists({ code })) return fail(res, 409, "ROLE_CODE_EXISTS", "Mã vai trò đã tồn tại.");

  const role = await Role.create({ code, name: body.name, description: body.description ?? null, permissions: [...new Set(permissions)] });
  res.status(201).location(`${req.baseUrl}/${role._id}`).json(roleView(role, 0));
});

// R3: chi tiết vai trò
router.get("/:roleId", requirePermission("roles:read"), loadRole, async (req, res) => {
  res.json(roleView(req.role, await countUsers(req.role._id)));
});

// R4: sửa tên và mô tả
router.patch("/:roleId", requirePermission("roles:update"), loadRole, async (req, res) => {
  const body = req.body;
  if (!isPlainObject(body)) return fail(res, 400, "VALIDATION_ERROR", "Body phải là một đối tượng JSON.");
  const details = notAllowedFields(body, ["name", "description"]);
  if (!Object.keys(body).length) details.push(detail("body", "EMPTY_BODY", "Cần gửi ít nhất một trường cần cập nhật."));
  if ("name" in body) {
    if (!isString(body.name) || !body.name.trim()) details.push(detail("name", "REQUIRED", "Tên vai trò không được để trống."));
    else if (body.name.trim().length < 2 || body.name.trim().length > 100) details.push(detail("name", "INVALID_VALUE", "Tên vai trò phải dài từ 2 đến 100 ký tự."));
  }
  if ("description" in body && body.description !== null && (!isString(body.description) || body.description.trim().length > 500))
    details.push(detail("description", "INVALID_VALUE", "Mô tả phải là chuỗi tối đa 500 ký tự."));
  if (details.length) return fail(res, 400, "VALIDATION_ERROR", VALIDATION_MSG, details);

  for (const k of ["name", "description"]) if (k in body) req.role[k] = body[k];
  await req.role.save();
  res.json(roleView(req.role, await countUsers(req.role._id)));
});

// R5: xóa vai trò
router.delete("/:roleId", requirePermission("roles:delete"), loadRole, async (req, res) => {
  if (req.role.isSystem) return fail(res, 409, "SYSTEM_ROLE_PROTECTED", "Không thể xóa vai trò hệ thống.");
  if ((await countUsers(req.role._id)) > 0) return fail(res, 409, "ROLE_IN_USE", "Vai trò đang được gán cho người dùng nên không thể xóa.");
  await req.role.deleteOne();
  await User.updateMany({ roles: req.role._id }, { $pull: { roles: req.role._id } }); // dọn tham chiếu còn sót ở người dùng đã xóa mềm
  res.status(204).end();
});

// RP1: quyền của vai trò
router.get("/:roleId/permissions", requirePermission("roles:read"), loadRole, async (req, res) => {
  const items = await Permission.find({ code: { $in: req.role.permissions } }).sort({ resource: 1, code: 1 });
  res.json({ data: items.map(permissionView), meta: { totalItems: items.length } });
});

// RP2: thay toàn bộ bộ quyền của vai trò
router.put("/:roleId/permissions", requirePermission("roles:update"), loadRole, async (req, res) => {
  const body = req.body;
  if (!isPlainObject(body)) return fail(res, 400, "VALIDATION_ERROR", "Body phải là một đối tượng JSON.");
  const details = notAllowedFields(body, ["permissions"]);
  if (details.length) return fail(res, 400, "VALIDATION_ERROR", VALIDATION_MSG, details);

  const check = await checkPermissionList(body.permissions);
  if (check) return sendCheck(res, check);
  if (req.role.isSystem) return fail(res, 409, "SYSTEM_ROLE_PROTECTED", "Không thể đổi bộ quyền của vai trò hệ thống.");

  // Chống leo thang trên phần thay đổi: cả quyền được thêm vào lẫn quyền bị bớt đi đều phải thuộc quyền người gọi
  const next = [...new Set(body.permissions)];
  const added = next.filter((p) => !req.role.permissions.includes(p));
  const removed = req.role.permissions.filter((p) => !next.includes(p));
  const missing = missingPermissions([...added, ...removed], req.permissions);
  if (missing.length) return fail(res, 403, "PRIVILEGE_ESCALATION", `Không thể thêm hoặc bớt các quyền mà bạn không có: ${missing.join(", ")}.`);

  req.role.permissions = next;
  await req.role.save();
  res.json(roleView(req.role, await countUsers(req.role._id)));
});

// Mở rộng: người dùng đang mang vai trò, có phân trang
router.get("/:roleId/users", requirePermission("roles:read", "users:read"), loadRole, async (req, res) => {
  const details = [];
  const { page, limit } = parsePaging(req.query, details);
  if (details.length) return fail(res, 400, "INVALID_QUERY_PARAMETER", "Tham số truy vấn không hợp lệ.", details);
  const filter = { roles: req.role._id, status: { $ne: "deleted" } };
  const [items, totalItems] = await Promise.all([
    User.find(filter).sort({ fullName: 1, _id: 1 }).collation(VI_COLLATION).skip((page - 1) * limit).limit(limit).populate("roles"),
    User.countDocuments(filter),
  ]);
  res.json({ data: items.map(userView), meta: pageMeta(page, limit, totalItems) });
});

module.exports = router;
