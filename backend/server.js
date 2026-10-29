require("dotenv").config();
const path = require("path");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const { fail, detail } = require("./utils/http");

const app = express();
app.set("trust proxy", 1); // sau reverse proxy của host, req.ip lấy từ X-Forwarded-For
app.disable("x-powered-by");

// CORS: chỉ cho phép các origin trong danh sách trắng, không mở cho mọi origin
const allowed = (process.env.CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
app.use(
  cors({
    origin: (origin, cb) => cb(null, !origin || allowed.includes(origin)),
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Authorization", "Content-Type"],
    exposedHeaders: ["Location"],
    maxAge: 600, // trình duyệt được lưu kết quả preflight 10 phút, giảm số request OPTIONS
  })
);
app.use(express.json({ limit: "100kb" }));

// Kiểm tra sức khỏe cho nền tảng triển khai, không nằm trong /api/v1
app.get("/healthz", (req, res) => res.json({ status: "ok" }));

// Routes
app.use("/api/v1", require("./routes/auth")); // /auth/tokens, /me
app.use("/api/v1/users", require("./routes/users"));
app.use("/api/v1/roles", require("./routes/roles"));
app.use("/api/v1/permissions", require("./routes/permissions"));

// Tùy chọn: phục vụ luôn Frontend để triển khai bằng một dịch vụ duy nhất
if (process.env.SERVE_FRONTEND === "true") app.use(express.static(path.join(__dirname, "..", "frontend")));

// 404 dạng JSON cho endpoint không tồn tại
app.use((req, res) => fail(res, 404, "ENDPOINT_NOT_FOUND", `Không có endpoint ${req.method} ${req.path}.`));

// Error handler chung
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") return fail(res, 400, "MALFORMED_JSON", "Body không phải JSON hợp lệ.");
  if (err.type === "entity.too.large") return fail(res, 400, "VALIDATION_ERROR", "Body vượt quá giới hạn 100kb.");
  if (err.type && String(err.type).startsWith("encoding.")) return fail(res, 400, "VALIDATION_ERROR", "Body có mã hóa không được hỗ trợ.");
  if (err.name === "ValidationError") {
    const details = Object.values(err.errors).map((e) => detail(e.path, e.kind === "required" ? "REQUIRED" : "INVALID_VALUE", e.message));
    return fail(res, 400, "VALIDATION_ERROR", "Dữ liệu đầu vào không hợp lệ.", details);
  }
  if (err.code === 11000) {
    // Chỉ xảy ra khi hai request cùng tạo một giá trị duy nhất, vì route đã kiểm tra trước
    const key = Object.keys(err.keyPattern || err.keyValue || {})[0];
    if (key === "email") return fail(res, 409, "EMAIL_ALREADY_EXISTS", "Email đã được sử dụng.");
    if (key === "code") return fail(res, 409, "ROLE_CODE_EXISTS", "Mã vai trò đã tồn tại.");
    return fail(res, 409, "CONFLICT", "Dữ liệu bị trùng.");
  }
  console.error(err); // chi tiết chỉ ghi log phía server
  fail(res, 500, "INTERNAL_ERROR", "Đã có lỗi phía server. Vui lòng thử lại sau.");
});

async function start() {
  for (const key of ["MONGODB_URI", "JWT_SECRET"]) {
    if (!process.env[key]) {
      console.error(`Thiếu biến môi trường ${key}. Xem backend/.env.example.`);
      process.exit(1);
    }
  }
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    console.log("Connected to MongoDB");
    // Bảo đảm unique index tồn tại trước khi nhận request
    await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  } catch (err) {
    console.error("MongoDB Error:", err.message);
    process.exit(1);
  }
  const PORT = Number(process.env.PORT || 3001);
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}

if (require.main === module) start();

module.exports = app;
