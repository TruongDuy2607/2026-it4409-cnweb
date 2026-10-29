const { detail } = require("./http");

// Các quy tắc kiểm tra dùng chung cho POST /users, PATCH /users/:userId và PATCH /me
const EMAIL_RE = /^\S+@\S+\.\S+$/;
const PHONE_RE = /^\+[1-9]\d{7,14}$/;
const PASSWORD_RE = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
const ROLE_CODE_RE = /^[a-z][a-z0-9-]{2,49}$/;

const isString = (v) => typeof v === "string";

function checkEmail(value, details) {
  if (!isString(value) || !value.trim()) return void details.push(detail("email", "REQUIRED", "Email không được để trống."));
  if (!EMAIL_RE.test(value.trim())) details.push(detail("email", "INVALID_VALUE", "Email không đúng định dạng."));
}

function checkFullName(value, details) {
  if (!isString(value) || !value.trim()) return void details.push(detail("fullName", "REQUIRED", "Họ tên không được để trống."));
  const len = value.trim().length;
  if (len < 2 || len > 100) details.push(detail("fullName", "INVALID_VALUE", "Họ tên phải dài từ 2 đến 100 ký tự."));
}

// phone không bắt buộc: chấp nhận null; nếu có giá trị phải theo E.164
function checkPhone(value, details) {
  if (value === null || value === undefined) return;
  if (!isString(value) || !PHONE_RE.test(value.trim())) details.push(detail("phone", "INVALID_VALUE", "Số điện thoại theo định dạng E.164, ví dụ +84912345678."));
}

function checkPassword(value, details, field = "password") {
  if (!isString(value) || !value) return void details.push(detail(field, "REQUIRED", "Mật khẩu không được để trống."));
  if (!PASSWORD_RE.test(value)) details.push(detail(field, "WEAK_PASSWORD", "Mật khẩu tối thiểu 8 ký tự, có chữ hoa, chữ số và ký tự đặc biệt."));
}

module.exports = { EMAIL_RE, PHONE_RE, PASSWORD_RE, ROLE_CODE_RE, isString, checkEmail, checkFullName, checkPhone, checkPassword };
