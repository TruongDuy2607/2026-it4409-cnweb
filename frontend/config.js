// Cấu hình URL Backend. Đây là nơi DUY NHẤT cần đổi khi chuyển giữa Backend cục bộ, mock server và bản online.
// Khi triển khai, build command của host ghi đè file này bằng giá trị của biến môi trường API_BASE.
window.APP_CONFIG = {
  API_BASE: "http://localhost:3001/api/v1",
};
