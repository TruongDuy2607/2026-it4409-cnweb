// Sinh file RBAC-Ex3.postman_collection.json: node postman/build-collection.js
// Collection chứa T01 đến T24 của đề bài, cùng nhóm kiểm thử bước 1, quy tắc nghiệp vụ và phần mở rộng.
const fs = require("fs");
const path = require("path");

const H = "Authorization";
const bearer = (v) => ({ key: H, value: `Bearer {{${v}}}` });
const json = { key: "Content-Type", value: "application/json" };

function item(name, method, url, { token, body, raw, headers = [], pre = [], tests = [] } = {}) {
  const header = [...headers];
  if (token) header.unshift(bearer(token));
  const request = { method, header, url };
  if (body !== undefined) {
    request.header.push(json);
    request.body = { mode: "raw", raw: JSON.stringify(body, null, 2), options: { raw: { language: "json" } } };
  } else if (raw !== undefined) {
    request.header.push(json);
    request.body = { mode: "raw", raw, options: { raw: { language: "json" } } };
  }
  const event = [];
  if (pre.length) event.push({ listen: "prerequest", script: { type: "text/javascript", exec: pre } });
  if (tests.length) event.push({ listen: "test", script: { type: "text/javascript", exec: tests } });
  return { name, event, request };
}

// Các đoạn kiểm thử dùng lại
const status = (code) => `pm.test("Mã trạng thái ${code}", () => pm.response.to.have.status(${code}));`;
const errCode = (code) => `pm.test("error.code là ${code}", () => pm.expect(pm.response.json().error.code).to.eql("${code}"));`;
const noBody = `pm.test("Không có body", () => pm.expect(pm.response.text()).to.eql(""));`;
const setVar = (name, expr) => `pm.collectionVariables.set("${name}", ${expr});`;
const expectFail = (code, errorCode) => [status(code), errCode(errorCode)];

const login = (name, who, saveAs) =>
  item(name, "POST", "{{baseUrl}}/auth/tokens", {
    body: { grantType: "password", email: `{{${who}Email}}`, password: `{{${who}Password}}` },
    tests: [status(200), `const j = pm.response.json();`, `pm.test("Có accessToken kiểu Bearer", () => { pm.expect(j.tokenType).to.eql("Bearer"); pm.expect(j.accessToken).to.be.a("string"); });`, setVar(saveAs, "j.accessToken")],
  });

const folders = [];

// 00. Chuẩn bị
folders.push({
  name: "00. Chuẩn bị (đăng nhập 4 vai trò, lấy ID)",
  item: [
    login("Đăng nhập super-admin", "admin", "tokenAdmin"),
    login("Đăng nhập user-manager", "manager", "tokenManager"),
    login("Đăng nhập auditor", "auditor", "tokenAuditor"),
    login("Đăng nhập member", "member", "tokenMember"),
    item("Lấy ID các vai trò", "GET", "{{baseUrl}}/roles?limit=100", {
      token: "tokenAdmin",
      tests: [status(200), `pm.response.json().data.forEach((r) => pm.collectionVariables.set("roleId_" + r.code, r.id));`, `pm.test("Có đủ 4 vai trò mặc định", () => ["super-admin", "user-manager", "auditor", "member"].forEach((c) => pm.expect(pm.collectionVariables.get("roleId_" + c), c).to.be.a("string")));`],
    }),
    item("ID của super-admin", "GET", "{{baseUrl}}/me", { token: "tokenAdmin", tests: [status(200), setVar("adminId", "pm.response.json().id")] }),
    item("ID của user-manager", "GET", "{{baseUrl}}/me", { token: "tokenManager", tests: [status(200), setVar("managerId", "pm.response.json().id")] }),
  ],
});

// Bước 1: mục III.1.10 của đề
folders.push({
  name: "01. Bước 1: xác thực (mục 1.10 của đề)",
  item: [
    item("B01 Đăng nhập đúng", "POST", "{{baseUrl}}/auth/tokens", {
      body: { grantType: "password", email: "{{adminEmail}}", password: "{{adminPassword}}" },
      tests: [status(200), `pm.test("Có accessToken và expiresIn", () => { const j = pm.response.json(); pm.expect(j.accessToken).to.be.a("string"); pm.expect(j.expiresIn).to.be.a("number"); });`, `pm.test("Không cho phép cache", () => pm.expect(pm.response.headers.get("Cache-Control")).to.include("no-store"));`],
    }),
    item("B02a Sai mật khẩu", "POST", "{{baseUrl}}/auth/tokens", {
      body: { grantType: "password", email: "{{adminEmail}}", password: "Sai@Mat1khau" },
      tests: [...expectFail(401, "INVALID_CREDENTIALS"), setVar("msgWrongPassword", "pm.response.json().error.message")],
    }),
    item("B02b Sai email, cùng thông điệp", "POST", "{{baseUrl}}/auth/tokens", {
      body: { grantType: "password", email: "khong.ton.tai@sis.hust.edu.vn", password: "Sai@Mat1khau" },
      tests: [...expectFail(401, "INVALID_CREDENTIALS"), `pm.test("Thông điệp giống trường hợp sai mật khẩu", () => pm.expect(pm.response.json().error.message).to.eql(pm.collectionVariables.get("msgWrongPassword")));`],
    }),
    item("B03 Thiếu password", "POST", "{{baseUrl}}/auth/tokens", {
      body: { grantType: "password", email: "{{adminEmail}}" },
      tests: [...expectFail(400, "VALIDATION_ERROR"), `pm.test("details chỉ ra trường password", () => pm.expect(pm.response.json().error.details.map((d) => d.field)).to.include("password"));`],
    }),
    item("B04 GET /me không có Authorization", "GET", "{{baseUrl}}/me", { tests: expectFail(401, "UNAUTHENTICATED") }),
    item("B05 GET /me với token sửa một ký tự", "GET", "{{baseUrl}}/me", {
      headers: [{ key: H, value: "Bearer {{tokenAdmin}}x" }],
      tests: expectFail(401, "INVALID_TOKEN"),
    }),
    item("B06 GET /me đúng token", "GET", "{{baseUrl}}/me", {
      token: "tokenAdmin",
      tests: [status(200), `const j = pm.response.json();`, `pm.test("Có permissions đã sắp xếp", () => { pm.expect(j.permissions).to.be.an("array").that.is.not.empty; pm.expect(j.permissions).to.eql([...j.permissions].sort()); });`, `pm.test("Không có passwordHash", () => pm.expect(j).to.not.have.property("passwordHash"));`],
    }),
    item("B07 grantType sai", "POST", "{{baseUrl}}/auth/tokens", {
      body: { grantType: "client_credentials", email: "{{adminEmail}}", password: "{{adminPassword}}" },
      tests: expectFail(400, "VALIDATION_ERROR"),
    }),
  ],
});

// T01 đến T24
const T = [];
T.push(item("T01 GET /users không token", "GET", "{{baseUrl}}/users", { tests: expectFail(401, "UNAUTHENTICATED") }));
T.push(item("T02 GET /users bằng member", "GET", "{{baseUrl}}/users", { token: "tokenMember", tests: expectFail(403, "FORBIDDEN") }));
T.push(
  item("T03 GET /users phân trang và sắp xếp", "GET", "{{baseUrl}}/users?page=2&limit=3&sort=fullName", {
    token: "tokenAuditor",
    tests: [
      status(200),
      `const j = pm.response.json();`,
      `pm.test("meta đúng", () => { pm.expect(j.meta.page).to.eql(2); pm.expect(j.meta.limit).to.eql(3); pm.expect(j.meta.totalPages).to.eql(Math.max(1, Math.ceil(j.meta.totalItems / 3))); pm.expect(j.data.length).to.be.at.most(3); });`,
      `pm.test("Sắp xếp tăng dần theo fullName", () => { const n = j.data.map((u) => u.fullName); pm.expect(n).to.eql([...n].sort((a, b) => a.localeCompare(b, "vi"))); });`,
      `pm.test("Không có passwordHash và không có người dùng đã xóa", () => j.data.forEach((u) => { pm.expect(u).to.not.have.property("passwordHash"); pm.expect(u.status).to.not.eql("deleted"); }));`,
    ],
  })
);
T.push(
  item("T04 GET /users tìm kiếm và lọc", "GET", "{{baseUrl}}/users?q=nguyen&status=active", {
    token: "tokenAuditor",
    tests: [
      status(200),
      `const j = pm.response.json();`,
      `pm.test("Có kết quả", () => pm.expect(j.data.length).to.be.above(0));`,
      `pm.test("Chỉ gồm bản ghi active khớp từ khóa", () => j.data.forEach((u) => { pm.expect(u.status).to.eql("active"); pm.expect((u.fullName + " " + u.email).toLowerCase()).to.include("nguyen"); }));`,
    ],
  })
);
T.push(
  item("T05 GET /users?limit=500", "GET", "{{baseUrl}}/users?limit=500", {
    token: "tokenAuditor",
    tests: [...expectFail(400, "INVALID_QUERY_PARAMETER"), `pm.test("details nêu tham số limit", () => pm.expect(pm.response.json().error.details.map((d) => d.field)).to.include("limit"));`],
  })
);
T.push(
  item("T06 POST /users hợp lệ", "POST", "{{baseUrl}}/users", {
    token: "tokenManager",
    pre: [`pm.collectionVariables.set("victimEmail", "victim." + Date.now() + "@sis.hust.edu.vn");`],
    body: { email: "{{victimEmail}}", fullName: "Lê Văn Cường", phone: "+84901112233", password: "Victim@2026", roleIds: ["{{roleId_member}}"] },
    tests: [
      status(201),
      `const j = pm.response.json();`,
      `pm.test("Có header Location trỏ tới tài nguyên mới", () => pm.expect(pm.response.headers.get("Location")).to.eql("/api/v1/users/" + j.id));`,
      `pm.test("Không có passwordHash", () => { pm.expect(j).to.not.have.property("passwordHash"); pm.expect(JSON.stringify(j)).to.not.include("$2"); });`,
      `pm.test("Vai trò member được gán", () => pm.expect(j.roles.map((r) => r.code)).to.eql(["member"]));`,
      setVar("victimId", "j.id"),
      setVar("victimFullName", "j.fullName"),
    ],
  })
);
T.push(
  item("T07 POST /users trùng email", "POST", "{{baseUrl}}/users", {
    token: "tokenManager",
    body: { email: "{{victimEmail}}", fullName: "Lê Văn Cường", password: "Victim@2026" },
    tests: expectFail(409, "EMAIL_ALREADY_EXISTS"),
  })
);
T.push(
  item("T08 POST /users mật khẩu 123", "POST", "{{baseUrl}}/users", {
    token: "tokenManager",
    body: { email: "weak.{{$timestamp}}@sis.hust.edu.vn", fullName: "Mật Khẩu Yếu", password: "123" },
    tests: [...expectFail(400, "VALIDATION_ERROR"), `pm.test("issue WEAK_PASSWORD", () => pm.expect(pm.response.json().error.details.map((d) => d.issue)).to.include("WEAK_PASSWORD"));`],
  })
);
T.push(
  item("T09 POST /users kèm super-admin", "POST", "{{baseUrl}}/users", {
    token: "tokenManager",
    body: { email: "esc.{{$timestamp}}@sis.hust.edu.vn", fullName: "Leo Thang", password: "Esc@lation1", roleIds: ["{{roleId_super-admin}}"] },
    tests: expectFail(403, "PRIVILEGE_ESCALATION"),
  })
);
T.push(
  item("T10 PATCH /users/:id đổi phone", "PATCH", "{{baseUrl}}/users/{{victimId}}", {
    token: "tokenManager",
    body: { phone: "+84911222333" },
    tests: [
      status(200),
      `const j = pm.response.json();`,
      `pm.test("phone đổi, các trường khác giữ nguyên", () => { pm.expect(j.phone).to.eql("+84911222333"); pm.expect(j.email).to.eql(pm.collectionVariables.get("victimEmail")); pm.expect(j.fullName).to.eql(pm.collectionVariables.get("victimFullName")); pm.expect(j.status).to.eql("active"); pm.expect(j.roles.length).to.eql(1); });`,
    ],
  })
);
T.push(item("T11 PATCH /users/:id gửi roles", "PATCH", "{{baseUrl}}/users/{{victimId}}", { token: "tokenManager", body: { roles: ["{{roleId_super-admin}}"] }, tests: [...expectFail(400, "VALIDATION_ERROR"), `pm.test("issue FIELD_NOT_ALLOWED", () => pm.expect(pm.response.json().error.details[0].issue).to.eql("FIELD_NOT_ALLOWED"));`] }));
T.push(item("T12 PATCH chính mình status locked", "PATCH", "{{baseUrl}}/users/{{managerId}}", { token: "tokenManager", body: { status: "locked" }, tests: expectFail(403, "SELF_ACTION_FORBIDDEN") }));
T.push(
  { name: "T13 PUT gán vai trò auditor hai lần", item: [
    item("T13a PUT lần 1", "PUT", "{{baseUrl}}/users/{{victimId}}/roles/{{roleId_auditor}}", { token: "tokenManager", tests: [status(204), noBody] }),
    item("T13b PUT lần 2", "PUT", "{{baseUrl}}/users/{{victimId}}/roles/{{roleId_auditor}}", { token: "tokenManager", tests: [status(204), noBody] }),
    item("T13c Vai trò không bị trùng", "GET", "{{baseUrl}}/users/{{victimId}}/roles", { token: "tokenManager", tests: [status(200), `const j = pm.response.json();`, `pm.test("auditor xuất hiện đúng một lần", () => pm.expect(j.data.filter((r) => r.code === "auditor").length).to.eql(1));`, `pm.test("meta.totalItems khớp", () => pm.expect(j.meta.totalItems).to.eql(j.data.length));`] }),
  ] }
);
T.push(item("T14 PUT gán super-admin", "PUT", "{{baseUrl}}/users/{{victimId}}/roles/{{roleId_super-admin}}", { token: "tokenManager", tests: expectFail(403, "PRIVILEGE_ESCALATION") }));
T.push(
  { name: "T15 Thu hồi vai trò có hiệu lực ngay", item: [
    item("T15a Admin tạo người dùng A mang user-manager", "POST", "{{baseUrl}}/users", {
      token: "tokenAdmin",
      pre: [`pm.collectionVariables.set("userAEmail", "usera." + Date.now() + "@sis.hust.edu.vn");`],
      body: { email: "{{userAEmail}}", fullName: "Người Dùng A", password: "UserA@2026", roleIds: ["{{roleId_user-manager}}"] },
      tests: [status(201), setVar("userAId", "pm.response.json().id")],
    }),
    item("T15b A đăng nhập", "POST", "{{baseUrl}}/auth/tokens", { body: { grantType: "password", email: "{{userAEmail}}", password: "UserA@2026" }, tests: [status(200), setVar("tokenA", "pm.response.json().accessToken")] }),
    item("T15c A gọi GET /users, còn quyền", "GET", "{{baseUrl}}/users?limit=1", { token: "tokenA", tests: [status(200)] }),
    item("T15d Admin gỡ user-manager của A", "DELETE", "{{baseUrl}}/users/{{userAId}}/roles/{{roleId_user-manager}}", { token: "tokenAdmin", tests: [status(204), noBody] }),
    item("T15e A gọi lại bằng token cũ", "GET", "{{baseUrl}}/users?limit=1", { token: "tokenA", tests: expectFail(403, "FORBIDDEN") }),
  ] }
);
T.push(item("T16 DELETE /users/:id bằng user-manager", "DELETE", "{{baseUrl}}/users/{{victimId}}", { token: "tokenManager", tests: expectFail(403, "FORBIDDEN") }));
T.push(
  { name: "T17 Xóa mềm người dùng", item: [
    item("T17a DELETE bằng super-admin", "DELETE", "{{baseUrl}}/users/{{victimId}}", { token: "tokenAdmin", tests: [status(204), noBody] }),
    item("T17b GET chi tiết sau khi xóa", "GET", "{{baseUrl}}/users/{{victimId}}", { token: "tokenAdmin", tests: expectFail(404, "USER_NOT_FOUND") }),
    item("T17c Đăng nhập tài khoản đã xóa", "POST", "{{baseUrl}}/auth/tokens", { body: { grantType: "password", email: "{{victimEmail}}", password: "Victim@2026" }, tests: expectFail(401, "INVALID_CREDENTIALS") }),
    item("T17d Email của tài khoản đã xóa vẫn bị giữ chỗ (BR-01)", "POST", "{{baseUrl}}/users", { token: "tokenAdmin", body: { email: "{{victimEmail}}", fullName: "Trùng Email", password: "Victim@2026" }, tests: expectFail(409, "EMAIL_ALREADY_EXISTS") }),
  ] }
);
T.push(item("T18 GET /users/abc", "GET", "{{baseUrl}}/users/abc", { token: "tokenAdmin", tests: expectFail(404, "USER_NOT_FOUND") }));
T.push(item("T19 POST /roles trùng mã", "POST", "{{baseUrl}}/roles", { token: "tokenAdmin", body: { code: "tro-giang", name: "Trợ giảng trùng", permissions: ["users:read"] }, tests: expectFail(409, "ROLE_CODE_EXISTS") }));
T.push(item("T20 PUT quyền của vai trò member", "PUT", "{{baseUrl}}/roles/{{roleId_member}}/permissions", { token: "tokenAdmin", body: { permissions: ["users:read"] }, tests: expectFail(409, "SYSTEM_ROLE_PROTECTED") }));
T.push({
  name: "T21 DELETE vai trò đang dùng",
  item: [
    item("T21a Lấy ID vai trò tro-giang", "GET", "{{baseUrl}}/roles?q=tro-giang", {
      token: "tokenAdmin",
      tests: [
        status(200),
        `const r = pm.response.json().data.find((x) => x.code === "tro-giang");`,
        `pm.test("Seed có vai trò tro-giang đang được gán", () => { pm.expect(r).to.be.an("object"); pm.expect(r.userCount).to.be.above(0); });`,
        `pm.collectionVariables.set("roleId_tro-giang", r.id);`,
      ],
    }),
    item("T21b DELETE /roles/:id", "DELETE", "{{baseUrl}}/roles/{{roleId_tro-giang}}", { token: "tokenAdmin", tests: expectFail(409, "ROLE_IN_USE") }),
  ],
});
T.push(item("T22 PUT quyền không tồn tại", "PUT", "{{baseUrl}}/roles/{{roleId_tro-giang}}/permissions", { token: "tokenAdmin", body: { permissions: ["users:fly"] }, tests: [...expectFail(400, "PERMISSION_NOT_FOUND"), `pm.test("details nêu users:fly", () => pm.expect(pm.response.json().error.details[0].message).to.include("users:fly"));`] }));
T.push(item("T23 Header X-User-Role tự đặt", "GET", "{{baseUrl}}/users", { token: "tokenMember", headers: [{ key: "X-User-Role", value: "admin" }], tests: expectFail(403, "FORBIDDEN") }));
T.push(item("T24 POST /users body JSON hỏng", "POST", "{{baseUrl}}/users", { token: "tokenManager", raw: '{ "email": "x@x.vn", ', tests: expectFail(400, "MALFORMED_JSON") }));
folders.push({ name: "02. Test cases bắt buộc T01 đến T24", item: T });

// Quy tắc nghiệp vụ bổ sung
folders.push({
  name: "03. Quy tắc nghiệp vụ bổ sung (BR-03, BR-05, BR-08, mass assignment, leo thang vai trò)",
  item: [
    item("X01 Super-admin tự khóa mình", "PATCH", "{{baseUrl}}/users/{{adminId}}", { token: "tokenAdmin", body: { status: "locked" }, tests: expectFail(403, "SELF_ACTION_FORBIDDEN") }),
    item("X02 Super-admin tự xóa mình", "DELETE", "{{baseUrl}}/users/{{adminId}}", { token: "tokenAdmin", tests: expectFail(403, "SELF_ACTION_FORBIDDEN") }),
    item("X03 Tự gỡ vai trò của mình", "DELETE", "{{baseUrl}}/users/{{managerId}}/roles/{{roleId_user-manager}}", { token: "tokenManager", tests: expectFail(403, "SELF_ACTION_FORBIDDEN") }),
    item("X04 Xóa vai trò hệ thống", "DELETE", "{{baseUrl}}/roles/{{roleId_member}}", { token: "tokenAdmin", tests: expectFail(409, "SYSTEM_ROLE_PROTECTED") }),
    item("X05 POST /users gửi trường status", "POST", "{{baseUrl}}/users", { token: "tokenAdmin", body: { email: "mass.{{$timestamp}}@sis.hust.edu.vn", fullName: "Mass Assignment", password: "Mass@2026x", status: "locked", isAdmin: true }, tests: [...expectFail(400, "VALIDATION_ERROR"), `pm.test("Cả hai trường lạ bị báo FIELD_NOT_ALLOWED", () => pm.expect(pm.response.json().error.details.filter((d) => d.issue === "FIELD_NOT_ALLOWED").map((d) => d.field).sort()).to.eql(["isAdmin", "status"]));`] }),
    item("X06 Gỡ vai trò người dùng vốn không có", "DELETE", "{{baseUrl}}/users/{{userAId}}/roles/{{roleId_auditor}}", { token: "tokenAdmin", tests: [status(204), noBody] }),
    item("X07 Gán vai trò không tồn tại", "PUT", "{{baseUrl}}/users/{{userAId}}/roles/000000000000000000000000", { token: "tokenAdmin", tests: expectFail(404, "ROLE_NOT_FOUND") }),
    item("X08 Endpoint không tồn tại trả JSON", "GET", "{{baseUrl}}/khong-co", { token: "tokenAdmin", tests: expectFail(404, "ENDPOINT_NOT_FOUND") }),
    item("X09 Tạo người dùng sẽ bị khóa", "POST", "{{baseUrl}}/users", { token: "tokenAdmin", pre: [`pm.collectionVariables.set("userLEmail", "userl." + Date.now() + "@sis.hust.edu.vn");`], body: { email: "{{userLEmail}}", fullName: "Người Dùng L", password: "UserL@2026" }, tests: [status(201), setVar("userLId", "pm.response.json().id")] }),
    item("X10 L đăng nhập khi còn hoạt động", "POST", "{{baseUrl}}/auth/tokens", { body: { grantType: "password", email: "{{userLEmail}}", password: "UserL@2026" }, tests: [status(200), setVar("tokenL", "pm.response.json().accessToken")] }),
    item("X11 Admin khóa L", "PATCH", "{{baseUrl}}/users/{{userLId}}", { token: "tokenAdmin", body: { status: "locked" }, tests: [status(200), `pm.test("status là locked", () => pm.expect(pm.response.json().status).to.eql("locked"));`] }),
    item("X12 L đăng nhập khi đã khóa", "POST", "{{baseUrl}}/auth/tokens", { body: { grantType: "password", email: "{{userLEmail}}", password: "UserL@2026" }, tests: expectFail(403, "ACCOUNT_LOCKED") }),
    item("X13 Token cũ của L không còn hiệu lực", "GET", "{{baseUrl}}/me", { token: "tokenL", tests: expectFail(401, "INVALID_TOKEN") }),
    item("X14 Admin mở khóa L", "PATCH", "{{baseUrl}}/users/{{userLId}}", { token: "tokenAdmin", body: { status: "active" }, tests: [status(200)] }),
    item("X15 L đăng nhập lại được", "POST", "{{baseUrl}}/auth/tokens", { body: { grantType: "password", email: "{{userLEmail}}", password: "UserL@2026" }, tests: [status(200)] }),
    item("X16 Tạo vai trò mới bằng super-admin", "POST", "{{baseUrl}}/roles", { token: "tokenAdmin", pre: [`pm.collectionVariables.set("tmpRoleCode", "e2e-" + Date.now().toString(36));`], body: { code: "{{tmpRoleCode}}", name: "Vai trò kiểm thử", description: "Tạo bởi Postman", permissions: ["roles:read", "roles:create", "roles:update"] }, tests: [status(201), `const j = pm.response.json();`, `pm.test("Location và dữ liệu đúng", () => { pm.expect(pm.response.headers.get("Location")).to.eql("/api/v1/roles/" + j.id); pm.expect(j.isSystem).to.eql(false); pm.expect(j.userCount).to.eql(0); });`, setVar("tmpRoleId", "j.id")] }),
    item("X17 Gán vai trò kiểm thử cho L", "PUT", "{{baseUrl}}/users/{{userLId}}/roles/{{tmpRoleId}}", { token: "tokenAdmin", tests: [status(204)] }),
    item("X18 L đăng nhập để lấy token mang vai trò kiểm thử", "POST", "{{baseUrl}}/auth/tokens", { body: { grantType: "password", email: "{{userLEmail}}", password: "UserL@2026" }, tests: [status(200), setVar("tokenL", "pm.response.json().accessToken")] }),
    item("X19 L tạo vai trò chứa quyền mình không có", "POST", "{{baseUrl}}/roles", { token: "tokenL", body: { code: "{{tmpRoleCode}}-x", name: "Leo thang", permissions: ["users:delete"] }, tests: expectFail(403, "PRIVILEGE_ESCALATION") }),
    item("X20 L thêm quyền mình không có vào vai trò khác", "PUT", "{{baseUrl}}/roles/{{roleId_tro-giang}}/permissions", { token: "tokenL", body: { permissions: ["users:read", "roles:read", "users:delete"] }, tests: expectFail(403, "PRIVILEGE_ESCALATION") }),
    item("X21 L không đủ roles:delete để xóa vai trò", "DELETE", "{{baseUrl}}/roles/{{tmpRoleId}}", { token: "tokenL", tests: expectFail(403, "FORBIDDEN") }),
    item("X22 Admin xóa vai trò đang dùng thất bại", "DELETE", "{{baseUrl}}/roles/{{tmpRoleId}}", { token: "tokenAdmin", tests: expectFail(409, "ROLE_IN_USE") }),
    item("X23 Admin xóa mềm L rồi dọn vai trò kiểm thử", "DELETE", "{{baseUrl}}/users/{{userLId}}", { token: "tokenAdmin", tests: [status(204)] }),
    item("X24 Xóa vai trò kiểm thử sau khi không còn người dùng", "DELETE", "{{baseUrl}}/roles/{{tmpRoleId}}", { token: "tokenAdmin", tests: [status(204), noBody] }),
    item("X25 GET /roles trả userCount và meta", "GET", "{{baseUrl}}/roles?sort=code&limit=2&page=1", { token: "tokenAuditor", tests: [status(200), `const j = pm.response.json();`, `pm.test("meta và userCount hợp lệ", () => { pm.expect(j.data.length).to.be.at.most(2); pm.expect(j.meta.limit).to.eql(2); j.data.forEach((r) => pm.expect(r.userCount).to.be.a("number")); });`, `pm.test("Sắp xếp theo code", () => pm.expect(j.data.map((r) => r.code)).to.eql(j.data.map((r) => r.code).sort()));`] }),
    item("X26 GET /roles/:id/permissions", "GET", "{{baseUrl}}/roles/{{roleId_auditor}}/permissions", { token: "tokenAuditor", tests: [status(200), `const j = pm.response.json();`, `pm.test("Đúng ba quyền của auditor", () => pm.expect(j.data.map((p) => p.code).sort()).to.eql(["permissions:read", "roles:read", "users:read"]));`, `pm.test("Mỗi quyền có resource và action", () => j.data.forEach((p) => { pm.expect(p.resource).to.be.a("string"); pm.expect(p.action).to.be.a("string"); }));`] }),
    item("X27 GET /permissions?resource=users", "GET", "{{baseUrl}}/permissions?resource=users", { token: "tokenAuditor", tests: [status(200), `pm.test("Chỉ quyền thuộc resource users", () => { const j = pm.response.json(); pm.expect(j.data.length).to.eql(4); j.data.forEach((p) => pm.expect(p.resource).to.eql("users")); });`] }),
    item("X28 GET /permissions bằng member", "GET", "{{baseUrl}}/permissions", { token: "tokenMember", tests: expectFail(403, "FORBIDDEN") }),
    item("X29 Tìm kiếm với ký tự đặc biệt không gây lỗi 500", "GET", "{{baseUrl}}/users?q=(((", { token: "tokenAuditor", tests: [status(200), `pm.test("Không có kết quả khớp chuỗi đã thoát ký tự", () => pm.expect(pm.response.json().data).to.eql([]));`] }),
    item("X30 q quá ngắn", "GET", "{{baseUrl}}/users?q=a", { token: "tokenAuditor", tests: expectFail(400, "INVALID_QUERY_PARAMETER") }),
    item("X31 sort theo trường không cho phép", "GET", "{{baseUrl}}/users?sort=passwordHash", { token: "tokenAuditor", tests: expectFail(400, "INVALID_QUERY_PARAMETER") }),
    item("X32 roleId sai định dạng", "GET", "{{baseUrl}}/users?roleId=abc", { token: "tokenAuditor", tests: expectFail(400, "INVALID_QUERY_PARAMETER") }),
    item("X33 Lọc theo roleId", "GET", "{{baseUrl}}/users?roleId={{roleId_auditor}}", { token: "tokenAuditor", tests: [status(200), `pm.test("Mọi người dùng đều mang vai trò auditor", () => { const j = pm.response.json(); pm.expect(j.data.length).to.be.above(0); j.data.forEach((u) => pm.expect(u.roles.map((r) => r.code)).to.include("auditor")); });`] }),
  ],
});

// Phần mở rộng
folders.push({
  name: "04. Phần mở rộng (PATCH /me, PUT /me/password, quyền hiệu lực, người dùng của vai trò, ETag)",
  item: [
    item("E01 PATCH /me", "PATCH", "{{baseUrl}}/me", { token: "tokenMember", body: { fullName: "Giảng viên Thành viên" }, tests: [status(200), `pm.test("Trả hồ sơ kèm permissions", () => { const j = pm.response.json(); pm.expect(j.fullName).to.eql("Giảng viên Thành viên"); pm.expect(j.permissions).to.eql([]); });`] }),
    item("E02 PATCH /me gửi trường cấm", "PATCH", "{{baseUrl}}/me", { token: "tokenMember", body: { roles: [] }, tests: expectFail(400, "VALIDATION_ERROR") }),
    item("E03 PUT /me/password sai mật khẩu hiện tại", "PUT", "{{baseUrl}}/me/password", { token: "tokenA", body: { currentPassword: "Sai@Mat1khau", newPassword: "UserA@2027" }, tests: [...expectFail(400, "VALIDATION_ERROR"), `pm.test("issue INCORRECT_PASSWORD", () => pm.expect(pm.response.json().error.details[0].issue).to.eql("INCORRECT_PASSWORD"));`] }),
    item("E04 PUT /me/password mật khẩu mới yếu", "PUT", "{{baseUrl}}/me/password", { token: "tokenA", body: { currentPassword: "UserA@2026", newPassword: "abc" }, tests: [...expectFail(400, "VALIDATION_ERROR"), `pm.test("issue WEAK_PASSWORD", () => pm.expect(pm.response.json().error.details[0].issue).to.eql("WEAK_PASSWORD"));`] }),
    item("E05 PUT /me/password thành công", "PUT", "{{baseUrl}}/me/password", { token: "tokenA", body: { currentPassword: "UserA@2026", newPassword: "UserA@2027" }, tests: [status(204), noBody] }),
    item("E06 Mật khẩu cũ không còn đăng nhập được", "POST", "{{baseUrl}}/auth/tokens", { body: { grantType: "password", email: "{{userAEmail}}", password: "UserA@2026" }, tests: expectFail(401, "INVALID_CREDENTIALS") }),
    item("E07 Mật khẩu mới đăng nhập được", "POST", "{{baseUrl}}/auth/tokens", { body: { grantType: "password", email: "{{userAEmail}}", password: "UserA@2027" }, tests: [status(200)] }),
    item("E08 GET /users/:id/permissions kèm nguồn", "GET", "{{baseUrl}}/users/{{managerId}}/permissions", { token: "tokenAuditor", tests: [status(200), `pm.test("Mỗi quyền nêu vai trò nguồn", () => { const j = pm.response.json(); pm.expect(j.data.length).to.eql(6); j.data.forEach((p) => pm.expect(p.sources.map((s) => s.code)).to.eql(["user-manager"])); });`] }),
    item("E09 GET /roles/:id/users", "GET", "{{baseUrl}}/roles/{{roleId_auditor}}/users", { token: "tokenAdmin", tests: [status(200), `pm.test("Mọi người dùng đều mang vai trò auditor", () => { const j = pm.response.json(); pm.expect(j.data.length).to.be.above(0); pm.expect(j.meta.totalItems).to.eql(j.data.length); j.data.forEach((u) => pm.expect(u.roles.map((r) => r.code)).to.include("auditor")); });`] }),
    item("E10 GET /permissions lần đầu lấy ETag", "GET", "{{baseUrl}}/permissions", { token: "tokenAdmin", tests: [status(200), `pm.test("Có ETag", () => pm.expect(pm.response.headers.get("ETag")).to.be.a("string"));`, setVar("permEtag", `pm.response.headers.get("ETag")`)] }),
    item("E11 GET /permissions kèm If-None-Match trả 304", "GET", "{{baseUrl}}/permissions", { token: "tokenAdmin", headers: [{ key: "If-None-Match", value: "{{permEtag}}" }, { key: "Cache-Control", value: "max-age=0" }], tests: [status(304)] }),
  ],
});

const collection = {
  info: {
    name: "IT4409 Ex3 RBAC",
    description: "Kiểm thử Backend RBAC. Chạy toàn bộ bằng Collection Runner hoặc newman theo đúng thứ tự thư mục. Đổi biến baseUrl để trỏ tới bản online.",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  item: folders,
  variable: [
    { key: "baseUrl", value: "http://localhost:3001/api/v1" },
    { key: "adminEmail", value: "gv.admin@sis.hust.edu.vn" },
    { key: "adminPassword", value: "Q6oWBRwd9kVkgt@9" },
    { key: "managerEmail", value: "gv.manager@sis.hust.edu.vn" },
    { key: "managerPassword", value: "Er5f4MTMiBFHk8@9" },
    { key: "auditorEmail", value: "gv.auditor@sis.hust.edu.vn" },
    { key: "auditorPassword", value: "oWEWMezS6Q5ikH@9" },
    { key: "memberEmail", value: "gv.member@sis.hust.edu.vn" },
    { key: "memberPassword", value: "h3eURYbfkKibjo@9" },
  ],
};
fs.writeFileSync(path.join(__dirname, "RBAC-Ex3.postman_collection.json"), JSON.stringify(collection, null, 2) + "\n");

const env = {
  id: "rbac-local",
  name: "RBAC local",
  values: [{ key: "baseUrl", value: "http://localhost:3001/api/v1", type: "default", enabled: true }],
  _postman_variable_scope: "environment",
};
fs.writeFileSync(path.join(__dirname, "RBAC-local.postman_environment.json"), JSON.stringify(env, null, 2) + "\n");
console.log("Đã tạo collection với", folders.reduce((n, f) => n + f.item.length, 0), "mục cấp 1 trong", folders.length, "thư mục.");
