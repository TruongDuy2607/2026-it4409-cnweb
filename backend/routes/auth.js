const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { authenticate } = require("../middleware/auth");
const { fail, detail, userView, isPlainObject, notAllowedFields } = require("../utils/http");
const { isString, checkFullName, checkPhone, checkPassword } = require("../utils/validate");
const { createLoginLimiter } = require("../utils/rateLimit");

const router = express.Router();
const ACCESS_TTL = Number(process.env.ACCESS_TOKEN_TTL || 3600);
const limiter = createLoginLimiter({
  maxAttempts: Number(process.env.LOGIN_MAX_ATTEMPTS || 10),
  windowMs: Number(process.env.LOGIN_WINDOW_SECONDS || 900) * 1000,
});

// Băm giả để thời gian phản hồi khi email không tồn tại gần bằng khi email tồn tại
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", 10);

const meView = (req) => ({ ...userView(req.user), permissions: [...req.permissions].sort() });

// A1: đăng nhập, công khai
router.post("/auth/tokens", async (req, res) => {
  const body = isPlainObject(req.body) ? req.body : {};
  const { grantType, email, password } = body;
  const details = [];
  if (grantType !== "password") details.push(detail("grantType", "UNSUPPORTED", "grantType phải là 'password'."));
  if (!isString(email) || !email.trim()) details.push(detail("email", "REQUIRED", "Thiếu email."));
  if (!isString(password) || !password) details.push(detail("password", "REQUIRED", "Thiếu mật khẩu."));
  if (details.length) return fail(res, 400, "VALIDATION_ERROR", "Dữ liệu đầu vào không hợp lệ.", details);

  const normalizedEmail = email.trim().toLowerCase();
  const limitKey = `${req.ip}|${normalizedEmail}`;
  const wait = limiter.retryAfter(limitKey);
  if (wait) {
    res.set("Retry-After", String(wait));
    return fail(res, 429, "TOO_MANY_ATTEMPTS", `Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ${wait} giây.`);
  }

  const user = await User.findOne({ email: normalizedEmail, status: { $ne: "deleted" } }).select("+passwordHash");
  const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok) {
    limiter.recordFailure(limitKey);
    // Cùng một thông điệp cho sai email và sai mật khẩu, để không lộ email nào tồn tại
    return fail(res, 401, "INVALID_CREDENTIALS", "Email hoặc mật khẩu không đúng.");
  }
  if (user.status === "locked") return fail(res, 403, "ACCOUNT_LOCKED", "Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.");

  limiter.reset(limitKey);
  await User.updateOne({ _id: user._id }, { lastLoginAt: new Date() });

  // Payload chỉ chứa sub, quyền không được nhúng vào token
  const accessToken = jwt.sign({ sub: String(user._id) }, process.env.JWT_SECRET, { algorithm: "HS256", expiresIn: ACCESS_TTL });
  res.set("Cache-Control", "no-store");
  res.json({ tokenType: "Bearer", accessToken, expiresIn: ACCESS_TTL });
});

// M1: hồ sơ, vai trò và quyền hiệu lực của người đang đăng nhập
router.get("/me", authenticate, (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(meView(req));
});

// Mở rộng: người dùng tự sửa họ tên và số điện thoại của mình
router.patch("/me", authenticate, async (req, res) => {
  const body = req.body;
  if (!isPlainObject(body)) return fail(res, 400, "VALIDATION_ERROR", "Body phải là một đối tượng JSON.");
  const details = notAllowedFields(body, ["fullName", "phone"]);
  if (!Object.keys(body).length) details.push(detail("body", "EMPTY_BODY", "Cần gửi ít nhất một trường cần cập nhật."));
  if ("fullName" in body) checkFullName(body.fullName, details);
  if ("phone" in body) checkPhone(body.phone, details);
  if (details.length) return fail(res, 400, "VALIDATION_ERROR", "Dữ liệu đầu vào không hợp lệ.", details);

  for (const k of ["fullName", "phone"]) if (k in body) req.user[k] = body[k];
  await req.user.save();
  res.json(meView(req));
});

// Mở rộng: tự đổi mật khẩu, cần mật khẩu hiện tại
router.put("/me/password", authenticate, async (req, res) => {
  const body = req.body;
  if (!isPlainObject(body)) return fail(res, 400, "VALIDATION_ERROR", "Body phải là một đối tượng JSON.");
  const details = notAllowedFields(body, ["currentPassword", "newPassword"]);
  if (!isString(body.currentPassword) || !body.currentPassword) details.push(detail("currentPassword", "REQUIRED", "Thiếu mật khẩu hiện tại."));
  checkPassword(body.newPassword, details, "newPassword");
  if (details.length) return fail(res, 400, "VALIDATION_ERROR", "Dữ liệu đầu vào không hợp lệ.", details);

  const user = await User.findById(req.user._id).select("+passwordHash");
  if (!(await bcrypt.compare(body.currentPassword, user.passwordHash)))
    return fail(res, 400, "VALIDATION_ERROR", "Dữ liệu đầu vào không hợp lệ.", [detail("currentPassword", "INCORRECT_PASSWORD", "Mật khẩu hiện tại không đúng.")]);
  if (body.currentPassword === body.newPassword)
    return fail(res, 400, "VALIDATION_ERROR", "Dữ liệu đầu vào không hợp lệ.", [detail("newPassword", "SAME_PASSWORD", "Mật khẩu mới phải khác mật khẩu hiện tại.")]);

  user.passwordHash = await bcrypt.hash(body.newPassword, 10);
  await user.save();
  res.status(204).end();
});

module.exports = router;
