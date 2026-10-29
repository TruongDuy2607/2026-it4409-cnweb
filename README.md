# Quản lý người dùng và phân quyền RBAC

Bài tập Fullstack số 03 của học phần Công nghệ Web và Dịch vụ trực tuyến (IT4409). Ứng dụng gồm Backend REST API (Node.js, Express 5, MongoDB, Mongoose, JWT) và Frontend React nạp từ CDN. Quyền của người dùng được tính từ các vai trò và được tra lại từ cơ sở dữ liệu ở mọi request.

## Cấu trúc thư mục

```
rbac-app/
├── backend/
│   ├── server.js              Khởi tạo app, CORS danh sách trắng, error handler thống nhất
│   ├── seed.js                Tạo quyền, vai trò, người dùng mẫu
│   ├── seed-users.json        Dữ liệu người dùng mẫu, thay bằng dữ liệu thật trước khi seed
│   ├── .env.example           Danh sách biến môi trường, không chứa giá trị thật
│   ├── models/                Permission, Role, User
│   ├── middleware/            auth.js (authenticate, requirePermission), loaders.js
│   ├── routes/                auth.js, users.js, roles.js, permissions.js
│   └── utils/                 http.js, validate.js, rbac.js, rateLimit.js
├── frontend/
│   ├── index.html             Ứng dụng React một tệp, nạp React, Babel, Axios từ CDN
│   └── config.js              URL Backend, nơi duy nhất cần đổi khi chuyển môi trường
├── postman/
│   ├── RBAC-Ex3.postman_collection.json   T01 đến T24 cùng kiểm thử bổ sung, mỗi request có test
│   ├── RBAC-local.postman_environment.json
│   └── build-collection.js    Sinh lại collection: node postman/build-collection.js
└── render.yaml                Blueprint triển khai lên Render
```

## Chạy ở máy local

Yêu cầu: Node.js 20 trở lên và một MongoDB (cài sẵn hoặc cụm MongoDB Atlas).

```bash
cd backend
npm install
cp .env.example .env        # điền MONGODB_URI, JWT_SECRET
node seed.js                # xóa và tạo lại dữ liệu mẫu trong 3 collection
npm start                   # http://localhost:3001
```

Mở thư mục `frontend` bằng VS Code Live Server tại `http://127.0.0.1:5500`, hoặc chạy `python3 -m http.server 5500 --bind 127.0.0.1` trong thư mục đó. Không mở tệp bằng `file://` vì origin `null` bị CORS chặn. Origin của Frontend phải có trong `CORS_ORIGINS`.

## Dữ liệu mẫu và tài khoản

`backend/seed-users.json` chứa dữ liệu minh họa. Trước khi nộp bài cần thay bằng dữ liệu thật theo mục III.1.11 của đề: bản thân ở dòng đầu với vai trò `super-admin`, thành viên nhóm với vai trò `user-manager` và `auditor`, các bạn xung quanh với vai trò `member`, và ít nhất một vai trò tự tạo được gán cho ít nhất một người. Người ở dòng đầu của tệp xuất hiện đầu danh sách trên giao diện.

Bốn tài khoản dành cho giảng viên và bộ Postman collection dùng các email `gv.admin`, `gv.manager`, `gv.auditor`, `gv.member` ở tên miền `sis.hust.edu.vn`. Nên đổi mật khẩu của chúng trong `seed-users.json` và trong biến collection của Postman trước khi công khai repository.

## Kiểm thử bằng Postman

1. Import `postman/RBAC-Ex3.postman_collection.json` và `postman/RBAC-local.postman_environment.json`.
2. Chạy `node seed.js` để đưa dữ liệu về trạng thái ban đầu, rồi bật Backend.
3. Chạy toàn bộ collection bằng Collection Runner theo đúng thứ tự thư mục. Để kiểm thử bản online, đổi biến `baseUrl` thành `https://<backend>/api/v1`.

Dùng dòng lệnh: `npx newman run postman/RBAC-Ex3.postman_collection.json`. Collection gồm thư mục chuẩn bị, bước 1 của đề, T01 đến T24, các quy tắc nghiệp vụ bổ sung và phần mở rộng. Có thể chạy lại nhiều lần mà không cần seed lại, vì mọi bản ghi tạo ra đều dùng email hoặc mã duy nhất theo thời gian.

## Triển khai online

Cấu hình trong `render.yaml` dùng Render cho Backend và Frontend, MongoDB Atlas cho cơ sở dữ liệu. Cấu hình chưa được chạy thử trên Render từ môi trường phát triển, nên cần kiểm tra lại khi triển khai.

1. MongoDB Atlas: tạo cụm M0, tạo database user, mở Network Access cho `0.0.0.0/0` (Render free không có IP tĩnh), lấy chuỗi kết nối dạng `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/it4409_rbac`.
2. Nạp dữ liệu mẫu vào Atlas từ máy cá nhân: đặt `MONGODB_URI` của Atlas trong `backend/.env` rồi chạy `node seed.js`.
3. Render: New, Blueprint, chọn repository. Với dịch vụ `rbac-api` điền `MONGODB_URI` và `CORS_ORIGINS` (origin của Frontend, không có dấu gạch chéo cuối). Với dịch vụ `rbac-web` điền `API_BASE` dạng `https://<rbac-api>.onrender.com/api/v1`.
4. Sau khi có tên miền thực của Frontend, cập nhật `CORS_ORIGINS` của Backend rồi deploy lại Backend.
5. Kiểm tra `https://<rbac-api>.onrender.com/healthz`, mở Frontend, đăng nhập, rồi chạy Postman collection với `baseUrl` của bản online.

Gói miễn phí của Render tự tắt Backend sau khoảng 15 phút không có truy cập, nên request đầu tiên sau đó chậm hơn bình thường do khởi động lại. Phương án thay thế là đặt `SERVE_FRONTEND=true` cho Backend để phục vụ cả Frontend từ một dịch vụ, khi đó đặt `API_BASE` trong `frontend/config.js` thành `/api/v1`.

## Tóm tắt API

Base URL: `/api/v1`. Mọi endpoint, trừ đăng nhập, yêu cầu `Authorization: Bearer <accessToken>`.

| Nhóm | Endpoint | Quyền |
|---|---|---|
| Xác thực | `POST /auth/tokens`, `GET /me` | công khai, đã đăng nhập |
| Người dùng | `GET, POST /users`, `GET, PATCH, DELETE /users/:userId` | `users:read`, `users:create`, `users:update`, `users:delete` |
| Gán vai trò | `GET /users/:userId/roles`, `PUT, DELETE /users/:userId/roles/:roleId` | `users:read`, `roles:assign` |
| Vai trò | `GET, POST /roles`, `GET, PATCH, DELETE /roles/:roleId` | `roles:read`, `roles:create`, `roles:update`, `roles:delete` |
| Quyền của vai trò | `GET, PUT /roles/:roleId/permissions` | `roles:read`, `roles:update` |
| Danh mục quyền | `GET /permissions` | `permissions:read` |
| Mở rộng | `PATCH /me`, `PUT /me/password`, `GET /users/:userId/permissions`, `GET /roles/:roleId/users`, ETag cho `/permissions`, giới hạn đăng nhập sai (429) | như mô tả trong báo cáo |

Định dạng lỗi thống nhất: `{ "error": { "code", "message", "details?" } }`. Danh sách mã lỗi nằm ở phụ lục của đề bài.

## Khai báo sử dụng AI

Mã nguồn và tài liệu trong repository này được soạn với sự hỗ trợ của Claude (Anthropic). Chi tiết được khai báo trong mục 9 của báo cáo.
