const express = require("express");
const Permission = require("../models/Permission");
const { authenticate, requirePermission } = require("../middleware/auth");
const { fail, detail, permissionView } = require("../utils/http");
const { isString } = require("../utils/validate");

const router = express.Router();
router.use(authenticate);

// P1: danh mục quyền, có thể lọc theo resource. Express tự sinh ETag nên trình duyệt nhận được 304 khi dữ liệu không đổi.
router.get("/", requirePermission("permissions:read"), async (req, res) => {
  const { resource } = req.query;
  if (resource !== undefined && (!isString(resource) || !resource.trim()))
    return fail(res, 400, "INVALID_QUERY_PARAMETER", "Tham số truy vấn không hợp lệ.", [detail("resource", "INVALID_VALUE", "resource phải là chuỗi không rỗng.")]);
  const items = await Permission.find(resource ? { resource: resource.trim() } : {}).sort({ resource: 1, code: 1 });
  res.json({ data: items.map(permissionView), meta: { totalItems: items.length } });
});

module.exports = router;
