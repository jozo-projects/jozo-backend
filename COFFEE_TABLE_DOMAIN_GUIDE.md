# Coffee/Table Domain — triển khai từng phần

Tài liệu này ghi lại **nghiệp vụ coffee table** (flat theo số người, có session PIN, QR chỉ chứa `tableId`, snack tính thêm, drink 0đ) và **lộ trình triển khai** theo PR nhỏ.

## Tổng quan nghiệp vụ (đã chốt)

### 1) Bàn coffee (`CoffeeTable`)
- QR chỉ chứa `tableId`: ví dụ `https://order.jozo.com.vn/{tableId}`.
- Table có thể có `capacity`, `area`, `description`, `images`, v.v. (kế thừa một phần từ `Room` nhưng **không** tái sử dụng logic pricing theo thời lượng).

### 2) Session (`CoffeeSession`)
- Staff/admin **Start** / **Close** thủ công.
- Mỗi phiên có một `sessionId` mới (mỗi lúc **một** session mở cho mỗi `tableId`).
- Khi Start: hệ thống tạo `pinCode` ngẫu nhiên và lưu `pinHash` trong DB.
- Khi Close: session chuyển `closed`, **pinHash bị xoá/invalid** để chặn khách cũ truy cập lại.
- PIN chỉ dùng cho **phiên hiện tại**.

### 3) Kích hoạt session từ QR + PIN
- Khách scan QR (chỉ lấy `tableId`) -> nhập PIN -> server cấp token/cookie **ràng buộc với `sessionId`**.
- Mọi API đặt món sau đó đều kiểm tra token/cookie gắn với session còn `open` và `tableId` khớp.
- Mục tiêu bảo mật: khách cũ giữ lại link/đổi thiết bị vẫn không dùng được nếu session đã bị đóng hoặc không có PIN đúng.

### 4) Pricing (flat)
- Giá không phụ thuộc thời lượng.
- Flat theo **số người**: ví dụ `pricePerPerson = 50,000đ`.
- Chính sách giờ (vd “tối đa 4 tiếng”) chỉ mang tính **nhắc nhở nhân viên**: nếu vượt quá thì staff gọi nhóm xuống và muốn tiếp tục thì phải Start session mới.
- Over time không phát sinh phí vì không tính theo duration.

### 5) Drinks & Snacks & Order history
- Drinks “gói” hoặc “theo plan”: **giá hiển thị 0đ**, nhưng vẫn được ghi vào **order history**.
- Snacks: tính theo `FnBMenu.schema.ts` price (và tuỳ chính sách: trừ tồn kho nếu mặt hàng có inventory).
- Snack không ăn hết: hệ thống **không cần** theo dõi “served/unserved”; khách có thể mang đi, hệ thống chỉ cần lịch sử order để billing/history.

## Thực thể đề xuất (để bạn map sang code)

- `coffee_tables` (collection)
  - `tableId` / `code` (duy nhất, dùng để map QR)
  - `name`, `isActive`, `capacity`, `area`, `description`, `images`
  - (tương lai) liên kết `coffee_plan_id` hoặc `coffee_table_type_id`

- `coffee_sessions` (collection)
  - `sessionId` (ObjectId)
  - `tableId` (string hoặc ref tới `coffee_tables`)
  - `status`: `open | closed`
  - `startTime`, `endTime` (endTime set khi Close)
  - `pinHash` (xoá khi Close)
  - `peopleCount`
  - `planSnapshot` (tuỳ cách bạn triển khai flat fee theo “plan/gói”)

- (tương lai) `coffee_orders` / `coffee_tabs` / `coffee_session_fnb_orders`
  - Gắn với `coffeeSessionId`
  - line items cho drinks/snacks (snapshot `name`, `unitPrice`, `quantity`, `category`)

## Kiến trúc triển khai (khuyến nghị)

- Tách domain “coffee” khỏi “room” để không vướng các service đang phụ thuộc `time_slots`/duration.
- Quy ước đặt tên:
  - Schema: file `CoffeeTable.schema.ts`, `CoffeeSession.schema.ts`, ...
  - Service: `coffeeTable.service.ts`, `coffeeSession.service.ts`, ...
  - Controller/Route: `coffeeTable.controller.ts`, `coffeeTable.routes.ts`, ...
  - Lộ trình: làm CRUD table trước, sau đó mới làm session/PIN/activation.

## Lộ trình theo PR (mỗi PR có “đầu ra” rõ ràng)

### PR #1 (Ngày mai): Quản lý CoffeeTable — CRUD
**Mục tiêu đầu ra:** admin/staff có thể `thêm / sửa / xoá / list / get` table.

#### 1) Collection & model
- Tạo schema `CoffeeTable` với các field tối thiểu:
  - `code` (unique, dùng cho QR)
  - `name`
  - `isActive` (default `true`)
  - `capacity` (optional)
  - `area` (optional)
  - `description` (optional)
  - `images` (optional, array)
  - `createdAt`, `updatedAt`, `createdBy`, `updatedBy` (tuỳ pattern hiện có)

#### 2) Validation bắt buộc
- `code` phải unique.
- Khi update: quy tắc bạn chọn:
  - Option A (an toàn): không cho đổi `code`.
  - Option B (linh hoạt): cho đổi nhưng phải đảm bảo không có session open gắn với table đó.

#### 3) API endpoints (đề xuất)
- `POST /coffee-tables` — create
- `GET /coffee-tables` — list (có query `isActive=true/false`, pagination nếu bạn cần)
- `GET /coffee-tables/:id` — get by id
- `PATCH /coffee-tables/:id` — update
- `DELETE /coffee-tables/:id` — delete (khuyến nghị soft delete: `isActive=false`)

#### 4) Những tiêu chí “done”
- Tạo được table mới với `code` unique.
- List trả đúng dữ liệu, filter `isActive` hoạt động.
- Update không phá unique constraint.
- Delete:
  - Nếu soft delete: table vẫn tồn tại trong DB nhưng `isActive=false`.
  - Nếu hard delete: cấm xoá khi còn `coffee_sessions` open (tuỳ bạn chọn).

### PR #2: CoffeeSession + PIN + Activate
- Start/Close session
- PIN/PIN hash invalidation khi close
- Route khách activate session -> set cookie/token bind `sessionId`
- Middleware kiểm tra session còn `open` cho mọi API đặt món

### PR #3: Gắn order F&B vào CoffeeSession
- Line items drinks/snacks
- Snapshots `name/unitPrice` vào order history
- Inventory theo chính sách `tracksInventory`

### PR #4: Bill tính flat theo số người + snack
- total = `peopleCount * pricePerPerson` + tổng snack
- drinks 0đ nhưng vẫn in vào bill/history

## Ghi chú quan trọng về tồn kho cho đồ pha chế (tránh vướng)

- Nếu món “pha chế” **không quản tồn thành phẩm** thì:
  - KHÔNG check/trừ `inventory.quantity` cho món đó,
  - nhưng vẫn cho phép order và ghi history.
- Vì codebase hiện tại có logic “chỉ cập nhật kho khi `item.inventory` tồn tại”, nên ở bước implement bạn cần có cờ/metadata rõ ràng (ví dụ `tracksInventory: false`) thay vì dựa vào `quantity = 0` (dễ gây chặn đặt hàng ngoài ý muốn).

