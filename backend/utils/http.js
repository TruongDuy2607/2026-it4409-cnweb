const mongoose = require("mongoose");

// Gửi lỗi theo định dạng thống nhất { error: { code, message, details? } }
function fail(res, status, code, message, details) {
  const error = { code, message };
  if (details && details.length) error.details = details;
  return res.status(status).json({ error });
}

const detail = (field, issue, message) => ({ field, issue, message });

// Lỗi cho các trường không nằm trong allow-list, nhằm chống mass assignment
function notAllowedFields(body, allowed) {
  return Object.keys(body || {})
    .filter((k) => !allowed.includes(k))
    .map((k) => detail(k, "FIELD_NOT_ALLOWED", `Trường '${k}' không được phép gửi lên endpoint này.`));
}

// Body của request phải là một đối tượng JSON thuần, không phải mảng hoặc giá trị đơn
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

const isObjectId = (id) =>
  typeof id === "string" && mongoose.isValidObjectId(id) && String(new mongoose.Types.ObjectId(id)) === String(id);

const MAX_PAGE = 1000000;

// Đọc và kiểm tra page và limit
function parsePaging(query, details) {
  const toNumber = (raw, fallback) => (raw === undefined ? fallback : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN);
  const page = toNumber(query.page, 1);
  const limit = toNumber(query.limit, 10);
  if (!Number.isInteger(page) || page < 1) details.push(detail("page", "INVALID_VALUE", "page phải là số nguyên không nhỏ hơn 1."));
  else if (page > MAX_PAGE) details.push(detail("page", "OUT_OF_RANGE", `page không được vượt quá ${MAX_PAGE}.`));
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) details.push(detail("limit", "OUT_OF_RANGE", "limit phải là số nguyên trong khoảng 1 đến 100."));
  return { page, limit };
}

// sort=-createdAt,fullName -> { createdAt: -1, fullName: 1 }
function parseSort(raw, allowed, details) {
  const sort = {};
  if (typeof raw !== "string") {
    details.push(detail("sort", "INVALID_VALUE", "sort phải là một chuỗi."));
    return sort;
  }
  for (const part of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const field = part.replace(/^-/, "");
    if (!allowed.includes(field)) {
      details.push(detail("sort", "FIELD_NOT_SORTABLE", `Không sắp xếp được theo '${field}'.`));
      continue;
    }
    sort[field] = part.startsWith("-") ? -1 : 1;
  }
  return sort;
}

// Thoát ký tự đặc biệt trước khi đưa từ khóa vào $regex
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const pageMeta = (page, limit, totalItems) => ({ page, limit, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / limit)) });

// Biểu diễn tài nguyên: chỉ chọn những trường được phép trả ra
const roleSummary = (r) => ({ id: String(r._id), code: r.code, name: r.name });

function userView(u) {
  return {
    id: String(u._id),
    email: u.email,
    fullName: u.fullName,
    phone: u.phone ?? null,
    status: u.status,
    roles: (u.roles || []).filter((r) => r && r.code).map(roleSummary),
    lastLoginAt: u.lastLoginAt ?? null,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

function roleView(r, userCount) {
  return {
    id: String(r._id),
    code: r.code,
    name: r.name,
    description: r.description ?? null,
    isSystem: r.isSystem,
    permissions: [...r.permissions],
    userCount,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

const permissionView = (p) => ({ code: p.code, resource: p.resource, action: p.action, description: p.description });

module.exports = {
  fail,
  detail,
  notAllowedFields,
  isPlainObject,
  isObjectId,
  parsePaging,
  parseSort,
  escapeRegex,
  pageMeta,
  userView,
  roleView,
  roleSummary,
  permissionView,
};
