const User = require("../models/User");
const Role = require("../models/Role");
const { fail, isObjectId } = require("../utils/http");

// Nạp người dùng theo :userId, bỏ qua người dùng đã xóa mềm. ID sai định dạng cũng trả 404.
async function loadUser(req, res, next) {
  const { userId } = req.params;
  const user = isObjectId(userId) ? await User.findOne({ _id: userId, status: { $ne: "deleted" } }).populate("roles") : null;
  if (!user) return fail(res, 404, "USER_NOT_FOUND", "Không tìm thấy người dùng.");
  req.target = user;
  next();
}

// Nạp vai trò theo :roleId
async function loadRole(req, res, next) {
  const { roleId } = req.params;
  const role = isObjectId(roleId) ? await Role.findById(roleId) : null;
  if (!role) return fail(res, 404, "ROLE_NOT_FOUND", "Không tìm thấy vai trò.");
  req.role = role;
  next();
}

module.exports = { loadUser, loadRole };
