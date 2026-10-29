const Role = require("../models/Role");
const User = require("../models/User");

// Những quyền trong danh sách mà người gọi KHÔNG có, dùng để chống leo thang đặc quyền
const missingPermissions = (codes, myPermissions) => [...new Set(codes)].filter((c) => !myPermissions.has(c));

// Người dùng có phải super-admin đang hoạt động cuối cùng không (BR-04).
// Chỉ tài khoản đang active mới được tính, vì tài khoản locked không đóng góp vào số super-admin hoạt động.
async function isLastSuperAdmin(user) {
  if (user.status !== "active") return false;
  const sa = await Role.findOne({ code: "super-admin" });
  if (!sa || !user.roles.some((r) => String(r._id || r) === String(sa._id))) return false;
  const others = await User.countDocuments({ _id: { $ne: user._id }, status: "active", roles: sa._id });
  return others === 0;
}

// Quyền hiệu lực của một người dùng đã populate roles: hợp các permission của mọi vai trò
const effectivePermissions = (user) => new Set((user.roles || []).filter(Boolean).flatMap((r) => r.permissions));

module.exports = { missingPermissions, isLastSuperAdmin, effectivePermissions };
