const Role = require("../models/Role");
const User = require("../models/User");

// Những quyền trong danh sách mà người gọi KHÔNG có, dùng để chống leo thang đặc quyền
const missingPermissions = (codes, myPermissions) => [...new Set(codes)].filter((c) => !myPermissions.has(c));

// Mã vai trò hệ thống mà BR-04 yêu cầu luôn còn ít nhất một người dùng active mang vai trò này
const SUPER_ADMIN_CODE = "super-admin";

// Người dùng có phải super-admin đang hoạt động cuối cùng không (BR-04).
// Chỉ tài khoản đang active mới được tính, vì tài khoản locked không đóng góp vào số super-admin hoạt động.
// Nếu truyền onlyRoleId thì chỉ trả true khi đó đúng là vai trò super-admin, dùng cho thao tác gỡ một vai trò.
async function isLastSuperAdmin(user, onlyRoleId) {
  if (user.status !== "active") return false;
  const sa = await Role.findOne({ code: SUPER_ADMIN_CODE });
  if (!sa || !user.roles.some((r) => String(r._id || r) === String(sa._id))) return false;
  if (onlyRoleId && String(onlyRoleId) !== String(sa._id)) return false;
  const others = await User.countDocuments({ _id: { $ne: user._id }, status: "active", roles: sa._id });
  return others === 0;
}

// Quyền hiệu lực của một người dùng đã populate roles: hợp các permission của mọi vai trò
const effectivePermissions = (user) => new Set((user.roles || []).filter(Boolean).flatMap((r) => r.permissions));

module.exports = { missingPermissions, isLastSuperAdmin, effectivePermissions };
