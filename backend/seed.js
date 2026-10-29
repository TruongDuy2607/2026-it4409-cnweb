require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const Permission = require("./models/Permission");
const Role = require("./models/Role");
const User = require("./models/User");
const { PASSWORD_RE } = require("./utils/validate");

// Danh mục quyền cố định theo mục II.1.2
const PERMISSIONS = [
  ["users:read", "Xem danh sách và chi tiết người dùng"],
  ["users:create", "Tạo người dùng"],
  ["users:update", "Sửa thông tin, khóa/mở khóa người dùng"],
  ["users:delete", "Xóa người dùng"],
  ["roles:read", "Xem vai trò và quyền của vai trò"],
  ["roles:create", "Tạo vai trò"],
  ["roles:update", "Sửa vai trò, thay bộ quyền của vai trò"],
  ["roles:delete", "Xóa vai trò"],
  ["roles:assign", "Gán / gỡ vai trò cho người dùng"],
  ["permissions:read", "Xem danh mục quyền"],
].map(([code, description]) => ({ code, resource: code.split(":")[0], action: code.split(":")[1], description }));

// Vai trò mặc định và ma trận quyền theo mục II.1.5, cộng một vai trò tự tạo
const ROLES = [
  { code: "super-admin", name: "Quản trị viên tối cao", description: "Toàn quyền trên hệ thống", isSystem: true, permissions: PERMISSIONS.map((p) => p.code) },
  {
    code: "user-manager",
    name: "Quản lý người dùng",
    description: "Quản lý tài khoản và gán vai trò trong phạm vi quyền của mình",
    isSystem: true,
    permissions: ["users:read", "users:create", "users:update", "roles:read", "roles:assign", "permissions:read"],
  },
  { code: "auditor", name: "Kiểm toán viên", description: "Chỉ xem dữ liệu người dùng và vai trò", isSystem: true, permissions: ["users:read", "roles:read", "permissions:read"] },
  { code: "member", name: "Thành viên", description: "Người dùng thông thường, không có quyền quản trị", isSystem: true, permissions: [] },
  { code: "tro-giang", name: "Trợ giảng", description: "Hỗ trợ xem danh sách người dùng", isSystem: false, permissions: ["users:read", "roles:read"] },
];

// Dữ liệu người dùng nằm trong seed-users.json để thay bằng dữ liệu thật mà không sửa mã
const usersFile = process.env.SEED_USERS_FILE || path.join(__dirname, "seed-users.json");
const USERS = JSON.parse(fs.readFileSync(usersFile, "utf8"));

(async () => {
  const roleCodes = new Set(ROLES.map((r) => r.code));
  for (const u of USERS) {
    if (!PASSWORD_RE.test(u.password)) throw new Error(`Mật khẩu của ${u.email} không đủ mạnh.`);
    for (const code of u.roles) if (!roleCodes.has(code)) throw new Error(`Vai trò '${code}' của ${u.email} không tồn tại.`);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Seed vào cơ sở dữ liệu '${mongoose.connection.name}'. Dữ liệu cũ của 3 collection sẽ bị xóa.`);
  await Promise.all([Permission.deleteMany({}), Role.deleteMany({}), User.deleteMany({})]);
  await Promise.all([Permission.init(), Role.init(), User.init()]); // tạo unique index

  await Permission.insertMany(PERMISSIONS);
  const roles = await Role.insertMany(ROLES);
  const roleId = Object.fromEntries(roles.map((r) => [r.code, r._id]));

  // Người dùng đứng đầu seed-users.json được tạo sau cùng, nên xuất hiện đầu danh sách khi sắp xếp mặc định -createdAt
  const base = Date.now();
  for (const [i, u] of USERS.entries()) {
    await User.create({
      createdAt: new Date(base - i * 1000),
      email: u.email,
      fullName: u.fullName,
      phone: u.phone ?? null,
      passwordHash: await bcrypt.hash(u.password, 10),
      roles: u.roles.map((code) => roleId[code]),
    });
  }
  console.log(`Đã tạo ${PERMISSIONS.length} quyền, ${roles.length} vai trò, ${USERS.length} người dùng.`);
  await mongoose.disconnect();
})().catch((err) => {
  console.error("Seed lỗi:", err.message);
  process.exit(1);
});
