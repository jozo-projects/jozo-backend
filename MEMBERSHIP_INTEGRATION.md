# Tích hợp Membership vào Bill Service

## Tổng quan

Hệ thống đã được tái cấu trúc để **tự động tích điểm membership** khi khách hàng thanh toán hóa đơn, sử dụng **phone_number** thay vì userId để đơn giản hóa logic.

## Lợi ích của việc dùng phone_number

✅ **Đơn giản hơn** - không cần query userId
✅ **Dễ lấy hơn** - có sẵn trong `schedule.customerPhone`
✅ **Frontend dễ làm** - chỉ cần truyền phone thay vì phải biết userId
✅ **Trace dễ hơn** - phone dễ nhận diện hơn ObjectId

## Kiến trúc

```
┌─────────────────────┐
│  Bill Controller    │
│  (bill.controller)  │
└──────────┬──────────┘
           │ gọi saveBillWithMembership()
           ↓
┌─────────────────────┐
│   Bill Service      │
│  (bill.service)     │
└──────────┬──────────┘
           │ 1. Lưu bill vào DB
           │ 2. Validate tránh trùng
           │ 3. Gọi earnPointsByPhone()
           ↓
┌─────────────────────┐
│ Membership Service  │
│ (membership.service)│
└─────────────────────┘
           │
           ↓
      - Tìm user theo phone
      - Cộng điểm
      - Cập nhật streak
      - Auto lên hạng
      - Auto tặng gift
```

## Flow chi tiết

### 1. Khách hàng thanh toán

```http
POST /api/bill/save
Content-Type: application/json

{
  "scheduleId": "507f1f77bcf86cd799439011",
  "roomId": "507f191e810c19729de860ea",
  "totalAmount": 250000,
  "items": [...],
  "paymentMethod": "cash",
  "customerPhone": "0987654321" // Chỉ cần phone, không cần userId
}
```

### 2. Bill Service xử lý (bill.service.ts)

Method: `saveBillWithMembership(billData: IBill)`

**Bước 1: Validate dữ liệu**
```typescript
if (!billData.scheduleId || !billData.roomId) {
  throw new ErrorWithStatus({ message: 'Missing required fields' })
}
```

**Bước 2: Tạo invoiceCode**
```typescript
// Format: #DDMMHHMM (ví dụ: #07021430)
billData.invoiceCode = `#${now.date()}${now.month()}${now.hour()}${now.minute()}`
```

**Bước 3: Kiểm tra tích điểm trùng**
```typescript
const existingReward = await databaseService.rewardHistories.findOne({
  'meta.invoiceCode': billData.invoiceCode
})

if (existingReward) {
  console.warn('Invoice đã được tích điểm rồi, bỏ qua')
}
```

**Bước 4: Lấy phone_number**
```typescript
// Ưu tiên 1: customerPhone từ bill
let customerPhone = billData.customerPhone

// Ưu tiên 2: Lấy từ schedule
if (!customerPhone) {
  const schedule = await databaseService.roomSchedule.findOne({ 
    _id: billData.scheduleId 
  })
  customerPhone = schedule?.customerPhone
}
```

**Bước 5: Lưu bill vào database**
```typescript
const billToSave = {
  ...billData,
  customerPhone: customerPhone || undefined
}
await databaseService.bills.insertOne(billToSave)
```

**Bước 6: Tích điểm tự động**
```typescript
if (customerPhone && !existingReward && totalAmount > 0) {
  await membershipService.earnPointsByPhone({
    phone_number: customerPhone,
    totalAmount: billToSave.totalAmount,
    source: RewardSource.Point,
    meta: {
      invoiceCode: billToSave.invoiceCode,
      method: 'auto'
    },
    visitAt: billToSave.endTime
  })
}
```

### 3. Membership Service xử lý (membership.service.ts)

Method: `earnPointsByPhone()` - **METHOD MỚI**

```typescript
async earnPointsByPhone(options: {
  phone_number: string
  totalAmount: number
  source?: RewardSource
  meta?: EarnMeta
  visitAt?: Date
}) {
  // 1. Tìm user theo phone_number
  const user = await databaseService.users.findOne({ 
    phone_number: options.phone_number 
  })
  
  if (!user) {
    throw new Error('Không tìm thấy user với số điện thoại này')
  }
  
  // 2. Gọi earnPointsForUser với userId
  return this.earnPointsForUser({
    userId: user._id,
    totalAmount: options.totalAmount,
    source: options.source,
    meta: {
      ...options.meta,
      phone: options.phone_number // Lưu phone vào meta
    },
    visitAt: options.visitAt
  })
}
```

**Logic tự động trong `earnPointsForUser()`:**
1. ✅ Tính điểm: `totalAmount / currencyUnit * pointPerCurrency`
2. ✅ Cộng điểm vào user
3. ✅ Cập nhật streak (chuỗi ngày)
4. ✅ **Tự động cộng điểm thưởng streak** (nếu đạt mốc)
5. ❌ **KHÔNG tự động tặng gift streak** - phải staff/admin manually claim
6. ✅ Kiểm tra lên hạng (Member → Gold → Platinum)
7. ✅ Tự động tặng gift theo hạng mới (tier gifts)

### Phân biệt: Auto vs Manual

| Loại thưởng | Tự động? | Lý do |
|-------------|----------|-------|
| **Điểm từ thanh toán** | ✅ Auto | Tính toán rõ ràng |
| **Điểm thưởng streak** | ✅ Auto | Đơn giản, chỉ là điểm |
| **Gift streak** | ❌ Manual | Cần verify tồn kho, phục vụ thực tế |
| **Tier gifts** | ✅ Auto | Lên hạng rõ ràng |

### Flow nhận Gift Streak (Manual)

```
1. Khách thanh toán → Auto cộng điểm + streak
2. Staff xem API getPendingAndEligibleGifts(phone)
   → Thấy danh sách gift streak có thể claim
3. Staff verify khách + tồn kho
4. Staff gọi claimStreakGift(phone, streakCount, scheduleId, staffId)
   → Assign gift + update status 'claimed'
5. Gift được phục vụ cho khách
```

## Response API

### Thành công (có tích điểm)

```json
{
  "message": "Bill saved successfully and membership points added",
  "result": {
    "bill": {
      "_id": "507f1f77bcf86cd799439011",
      "scheduleId": "507f1f77bcf86cd799439012",
      "totalAmount": 250000,
      "customerPhone": "0987654321",
      "invoiceCode": "#07021430",
      ...
    },
    "membership": {
      "success": true,
      "user": {
        "_id": "507f1f77bcf86cd799439013",
        "phone_number": "0987654321",
        "totalPoint": 2500,
        "availablePoint": 2500,
        "lifetimePoint": 2500,
        "tier": "Member",
        "streakCount": 3
      }
    }
  }
}
```

## Streak Gift Flow - Manual Claim by Staff

### Tại sao Gift Streak phải Manual?

1. ✅ **Verify tồn kho** - Staff kiểm tra còn hàng không
2. ✅ **Verify khách** - Đảm bảo đúng người đúng streak
3. ✅ **Phục vụ thực tế** - Trao gift tại quầy, ghi nhận ai phục vụ
4. ✅ **Tránh lỗi** - Không tự động trừ tồn kho khi chưa phục vụ

### API Flow cho Staff

#### 1. Check eligible gifts

```http
GET /api/membership/gifts/pending-eligible?userIdOrPhone=0987654321

Response:
{
  "user": {
    "userId": "...",
    "phone_number": "0987654321",
    "streakCount": 5
  },
  "pending": [],  // Gifts đã assigned chưa claimed
  "eligible": [   // Gifts có thể claim (đạt mốc streak)
    {
      "streakCount": 3,
      "giftId": "...",
      "giftName": "Trà sữa size M",
      "giftType": "snacks_drinks",
      "bonusPoints": 100
    },
    {
      "streakCount": 5,
      "giftId": "...",
      "giftName": "Combo snack",
      "giftType": "snacks_drinks",
      "bonusPoints": 200
    }
  ]
}
```

#### 2. Staff claim gift cho khách

```http
POST /api/membership/gifts/claim-streak

Body:
{
  "userIdOrPhone": "0987654321",
  "streakCount": 3,
  "scheduleId": "507f1f77bcf86cd799439011",
  "staffId": "507f191e810c19729de860ea"
}

Response:
{
  "message": "Claim streak gift successfully",
  "result": {
    "_id": "...",  // rewardHistoryId
    "userId": "...",
    "source": "Streak",
    "giftStatus": "claimed",
    "claimedBy": "507f191e810c19729de860ea",
    "giftClaimedAt": "2026-02-07T14:30:00Z",
    "meta": {
      "streakCount": 3,
      "giftId": "...",
      "giftName": "Trà sữa size M"
    }
  }
}
```

### Flow chi tiết Manual Claim

```
┌─────────────────────────────────────────────────────┐
│  1. Khách thanh toán                                │
│     → saveBill tự động:                             │
│        ✅ Cộng điểm (250k = 250đ)                   │
│        ✅ Cập nhật streak (count + 1)               │
│        ✅ Cộng điểm thưởng streak (nếu đủ mốc)     │
│        ❌ KHÔNG assign gift (chờ staff)             │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│  2. Staff check eligible gifts                      │
│     GET /api/membership/gifts/pending-eligible      │
│     → Thấy streak = 3, có gift "Trà sữa" eligible  │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│  3. Staff verify                                    │
│     ✅ Khách đúng người (check phone/name)          │
│     ✅ Tồn kho còn hàng                             │
│     ✅ Gift đúng loại                               │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│  4. Staff claim gift                                │
│     POST /api/membership/gifts/claim-streak         │
│     → Hệ thống:                                     │
│        ✅ Assign gift (create rewardHistory)        │
│        ✅ Trừ tồn kho                               │
│        ✅ Ghi nhận staff phục vụ                    │
│        ✅ Update status → 'claimed'                 │
│        ✅ Lưu vào schedule.streakGifts[]            │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│  5. Staff phục vụ gift cho khách                    │
│     → Trao gift thực tế tại quầy                    │
└─────────────────────────────────────────────────────┘
```

### Thành công (bỏ qua tích điểm)

```json
{
  "message": "Bill saved successfully (membership skipped: Không có phone_number)",
  "result": {
    "bill": { ... },
    "membership": {
      "success": false,
      "skipped": true,
      "reason": "Không có phone_number trong bill hoặc schedule"
    }
  }
}
```

### Thành công (lỗi tích điểm)

```json
{
  "message": "Bill saved successfully (membership error: Không tìm thấy user với số điện thoại 0987654321)",
  "result": {
    "bill": { ... },
    "membership": {
      "success": false,
      "error": "Không tìm thấy user với số điện thoại 0987654321"
    }
  }
}
```

## Các trường hợp đặc biệt

### 1. Không tích điểm khi:
- ❌ `customerPhone` không tồn tại
- ❌ `totalAmount = 0`
- ❌ Invoice đã được tích điểm trước đó (tránh trùng)
- ❌ User không tồn tại với `phone_number` đó

### 2. Bill vẫn được lưu khi:
- ✅ Lỗi tích điểm membership (không làm fail toàn bộ)
- ✅ Không có customerPhone
- ✅ totalAmount = 0
- ✅ User không tồn tại

## Config membership

File: `src/models/schemas/MembershipConfig.schema.ts`

```typescript
{
  currencyUnit: 1000,        // Mỗi 1,000 VNĐ
  pointPerCurrency: 1,       // = 1 điểm
  
  tierThresholds: {
    Member: 0,
    Gold: 10000,             // 10,000 điểm
    Platinum: 50000          // 50,000 điểm
  },
  
  streak: {
    windowDays: 14,          // Hết hạn sau 14 ngày
    rewards: [
      { count: 3, bonusPoints: 100, giftId: null },
      { count: 5, bonusPoints: 200, giftId: "..." },
      { count: 10, bonusPoints: 500, giftId: "..." }
    ]
  }
}
```

## Testing

### 1. Test tích điểm thành công

```bash
curl -X POST http://localhost:4000/api/bill/save \
  -H "Content-Type: application/json" \
  -d '{
    "scheduleId": "507f1f77bcf86cd799439011",
    "roomId": "507f191e810c19729de860ea",
    "totalAmount": 250000,
    "customerPhone": "0987654321",
    "items": [...]
  }'
```

### 2. Test không tích điểm (không có customerPhone)

```bash
curl -X POST http://localhost:4000/api/bill/save \
  -H "Content-Type: application/json" \
  -d '{
    "scheduleId": "507f1f77bcf86cd799439011",
    "roomId": "507f191e810c19729de860ea",
    "totalAmount": 250000,
    "items": [...]
  }'
```

### 3. Test tránh tích điểm trùng

```bash
# Gọi 2 lần với cùng invoiceCode
curl -X POST http://localhost:4000/api/bill/save \
  -H "Content-Type: application/json" \
  -d '{
    "scheduleId": "507f1f77bcf86cd799439011",
    "roomId": "507f191e810c19729de860ea",
    "totalAmount": 250000,
    "customerPhone": "0987654321",
    "invoiceCode": "#07021430",
    "items": [...]
  }'
```

### 4. Test với phone không tồn tại

```bash
curl -X POST http://localhost:4000/api/bill/save \
  -H "Content-Type: application/json" \
  -d '{
    "scheduleId": "507f1f77bcf86cd799439011",
    "roomId": "507f191e810c19729de860ea",
    "totalAmount": 250000,
    "customerPhone": "0999999999",
    "items": [...]
  }'
# Kết quả: Bill lưu thành công, membership error
```

## Database Schema

### Collection: bills

```typescript
{
  _id: ObjectId,
  scheduleId: ObjectId,
  roomId: ObjectId,
  customerPhone: string,          // ✨ Dùng phone thay vì userId
  totalAmount: number,
  items: Array,
  invoiceCode: string,            // #DDMMHHMM
  paymentMethod: string,
  startTime: Date,
  endTime: Date,
  createdAt: Date
}
```

### Collection: users

```typescript
{
  _id: ObjectId,
  phone_number: string,           // ✨ Dùng để tìm user
  name: string,
  totalPoint: number,
  availablePoint: number,
  lifetimePoint: number,
  tier: 'Member' | 'Gold' | 'Platinum'
}
```

### Collection: rewardHistories

```typescript
{
  _id: ObjectId,
  userId: ObjectId,
  points: number,
  source: 'Point' | 'Streak' | 'Tier',
  meta: {
    invoiceCode: string,         // Link về bill
    phone: string,               // ✨ Lưu phone để trace
    method: 'auto' | 'self-claim' | 'admin'
  },
  usedAt: Date,
  createdAt: Date
}
```

## Ưu điểm của kiến trúc này

### So sánh phone_number vs userId

| Tiêu chí | userId (cũ) | phone_number (mới) |
|----------|-------------|-------------------|
| Dễ lấy | ❌ Phải query user trước | ✅ Có sẵn trong schedule |
| Frontend | ❌ Phải biết userId | ✅ Chỉ cần phone |
| Trace/Debug | ❌ ObjectId khó đọc | ✅ Phone dễ nhận diện |
| Performance | ❌ 2 queries (phone→user, user→points) | ✅ 1 query (phone→user→points) |
| Code | ❌ Phức tạp hơn | ✅ Đơn giản hơn |

### Ưu điểm kiến trúc

1. ✅ **Separation of Concerns**: Logic tách biệt rõ ràng
2. ✅ **Single Responsibility**: Mỗi service làm đúng việc của nó
3. ✅ **Reusability**: Có thể dùng lại `earnPointsByPhone()` ở nhiều nơi
4. ✅ **Testability**: Dễ test từng layer riêng biệt
5. ✅ **Maintainability**: Dễ bảo trì và mở rộng
6. ✅ **Error Handling**: Lỗi tích điểm không làm fail bill
7. ✅ **Idempotency**: Tránh tích điểm trùng với invoiceCode
8. ✅ **Simplicity**: Phone dễ dùng hơn userId

## Migration từ code cũ

### Code cũ (trong controller):

```typescript
// ❌ Logic membership lẫn lộn trong controller
// ❌ Phải convert phone → userId trước
await databaseService.bills.insertOne(billToSave)
try {
  if (billToSave.userId) {
    await membershipService.earnPointsForUser({
      userId: billToSave.userId,
      ...
    })
  }
} catch (err) {
  console.warn('Tích điểm thất bại')
}
```

### Code mới (trong service):

```typescript
// ✅ Controller chỉ gọi 1 method
const result = await billService.saveBillWithMembership(bill)

// ✅ Logic tách biệt trong service, dùng phone trực tiếp
async saveBillWithMembership(billData) {
  // 1. Validate
  // 2. Lưu bill
  // 3. Tích điểm bằng phone (gọi membershipService.earnPointsByPhone)
  return { bill, membership }
}
```

### So sánh flow

**Flow cũ:**
```
Bill → Controller → Check userId → membershipService.earnPointsForUser
                        ↓ (phức tạp)
                   Query phone → userId
```

**Flow mới:**
```
Bill → Controller → billService.saveBillWithMembership
                        ↓ (đơn giản)
                   membershipService.earnPointsByPhone
                        ↓ (tự động)
                   Query phone → user → earnPointsForUser
```

## Câu hỏi thường gặp (FAQ)

**Q: Tại sao dùng phone_number thay vì userId?**  
A: Phone dễ lấy hơn (có sẵn trong schedule), frontend dễ làm hơn (không cần biết userId), và dễ trace/debug hơn.

**Q: Nếu không có customerPhone thì có lưu bill không?**  
A: Có, bill vẫn được lưu. Membership chỉ bị skip.

**Q: Nếu phone không tồn tại trong users thì sao?**  
A: Bill vẫn được lưu. Membership trả về error nhưng không làm fail request.

**Q: Nếu lỗi tích điểm thì có lưu bill không?**  
A: Có, bill vẫn được lưu. Lỗi tích điểm không làm fail request.

**Q: Làm sao tránh tích điểm trùng?**  
A: Kiểm tra `invoiceCode` trong `rewardHistories` trước khi tích điểm.

**Q: Khách tự claim điểm bằng phone thì sao?**  
A: Vẫn dùng API `claimInvoiceByPhone()` như cũ, không ảnh hưởng.

**Q: Có thể tắt tự động tích điểm không?**  
A: Có, bỏ `customerPhone` khỏi bill hoặc không pass customerPhone vào API.

**Q: Phone có cần format đặc biệt không?**  
A: Không, nhưng nên đồng nhất (ví dụ: "0987654321" hoặc "+84987654321").

**Q: Có thể dùng cả phone và userId không?**  
A: Có, nếu truyền cả 2 thì `customerPhone` được ưu tiên.

**Q: Tại sao Gift Streak phải manual claim mà không tự động?**  
A: Vì cần verify tồn kho, verify khách thực tế, và ghi nhận staff phục vụ. Tự động sẽ có nguy cơ trừ tồn kho nhưng chưa phục vụ.

**Q: Điểm thưởng streak có tự động không?**  
A: Có, điểm thưởng streak tự động cộng ngay khi thanh toán. Chỉ gift mới phải manual.

**Q: Gift theo tier (Member/Gold/Platinum) có tự động không?**  
A: Có, tier gifts tự động assign khi lên hạng vì đây là quyền lợi rõ ràng theo hạng.

**Q: Staff quên claim gift thì sao?**  
A: Gift vẫn ở trạng thái eligible, staff có thể claim sau bất cứ lúc nào.

**Q: Khách có thể claim nhiều gift streak cùng lúc không?**  
A: Có, staff có thể claim tất cả gifts mà khách đủ điều kiện (ví dụ: streak 3, 5, 10).

## Kết luận

Giải pháp này đảm bảo:
- ✅ Tách biệt logic rõ ràng (no spaghetti code)
- ✅ Tự động tích điểm khi thanh toán
- ✅ Tránh tích điểm trùng lặp
- ✅ Dễ maintain và mở rộng
- ✅ Error handling tốt
- ✅ **Đơn giản hóa với phone_number** - không cần userId

## API Methods Summary

### Bill Service
- `saveBillWithMembership(billData)` - Lưu bill + tích điểm tự động

### Membership Service  
- `earnPointsByPhone(options)` - ⭐ **Method mới** - Tích điểm bằng phone
- `earnPointsForUser(options)` - Method cũ - Tích điểm bằng userId (vẫn giữ)
- `claimInvoiceByPhone(invoiceCode, phone)` - Khách tự claim điểm

## Example Usage

```typescript
// Trong code của bạn
const result = await billService.saveBillWithMembership({
  scheduleId: new ObjectId(scheduleId),
  roomId: new ObjectId(roomId),
  customerPhone: '0987654321',  // ⭐ Chỉ cần phone
  totalAmount: 250000,
  items: [...],
  paymentMethod: 'cash'
})

// Kết quả
console.log(result.bill)           // Bill đã lưu
console.log(result.membership)     // Kết quả tích điểm
```
