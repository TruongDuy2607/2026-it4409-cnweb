const mongoose = require("mongoose");

const roleSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, "Mã vai trò không được để trống"],
      unique: true,
      trim: true,
      match: [/^[a-z][a-z0-9-]{2,49}$/, "Mã vai trò gồm chữ thường, số, gạch nối, dài 3 đến 50 ký tự và bắt đầu bằng chữ"],
      immutable: true, // không đổi sau khi tạo
    },
    name: {
      type: String,
      required: [true, "Tên vai trò không được để trống"],
      trim: true,
      minlength: [2, "Tên vai trò phải có ít nhất 2 ký tự"],
      maxlength: [100, "Tên vai trò tối đa 100 ký tự"],
    },
    description: { type: String, default: null, trim: true, maxlength: [500, "Mô tả tối đa 500 ký tự"] },
    isSystem: { type: Boolean, default: false, immutable: true },
    permissions: { type: [String], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Role", roleSchema);
