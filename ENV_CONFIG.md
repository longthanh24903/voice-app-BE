# Environment Variables Configuration

Tạo file `.env` trong thư mục `voice-app-BE` với nội dung sau:

```env
# Server Configuration
PORT=3000

# Security: Secret key for x-forward-secret header
# Leave empty to allow public access (not recommended for production)
FORWARD_SECRET=your-secret-key-here

# Proxy file path (relative to server.js or absolute path)
PROXY_FILE=proxies.txt
```

## Giải thích các biến môi trường:

- **PORT**: Port mà server sẽ chạy (mặc định: 3000)
- **FORWARD_SECRET**: Secret key để bảo vệ API. Nếu không set, server sẽ cho phép public access
- **PROXY_FILE**: Đường dẫn đến file chứa danh sách proxy (mặc định: proxies.txt)

## Cách sử dụng:

1. Copy nội dung trên vào file `.env`
2. Điều chỉnh các giá trị theo nhu cầu
3. Restart server để áp dụng thay đổi

