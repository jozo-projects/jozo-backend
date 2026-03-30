# API Testing Guide - Bill & Membership

Hướng dẫn chi tiết cho Frontend test API lưu bill và tích điểm membership.

## 🚀 API Endpoint chính

### POST `/api/bill/save`

**Endpoint:** `POST http://localhost:4000/api/bill/save`

**Authentication:** Required (Admin hoặc Staff token)

**Description:** Lưu bill và tự động tích điểm membership cho khách hàng

---

## 📋 Request Format

### Headers

```json
{
  "Authorization": "Bearer <access_token>",
  "Content-Type": "application/json"
}
```

### Body (Minimum Required)

```json
{
  "scheduleId": "507f1f77bcf86cd799439011",
  "roomId": "507f191e810c19729de860ea",
  "totalAmount": 250000,
  "items": [
    {
      "description": "Phi dich vu thu am\n(14:00-16:00)",
      "quantity": 2,
      "price": 100000,
      "totalPrice": 200000
    },
    {
      "description": "Tra sua",
      "quantity": 2,
      "price": 25000,
      "totalPrice": 50000
    }
  ],
  "customerPhone": "0987654321",
  "paymentMethod": "cash"
}
```

### Body (Full Options)

```json
{
  "scheduleId": "507f1f77bcf86cd799439011",
  "roomId": "507f191e810c19729de860ea",
  "totalAmount": 250000,
  "items": [
    {
      "description": "Phi dich vu thu am\n(14:00-16:00)",
      "quantity": 2,
      "price": 100000,
      "totalPrice": 200000
    }
  ],
  "customerPhone": "0987654321",
  "paymentMethod": "cash",
  "startTime": "2026-02-07T14:00:00Z",
  "endTime": "2026-02-07T16:00:00Z",
  "invoiceCode": "#07021430",
  "note": "Khach VIP",
  "gift": {
    "giftId": "507f1f77bcf86cd799439013",
    "name": "Giam 10%",
    "type": "discount_percentage",
    "discountPercentage": 10
  },
  "activePromotion": {
    "name": "Happy Hour",
    "discountPercentage": 20,
    "appliesTo": "all"
  },
  "freeHourPromotion": {
    "freeMinutesApplied": 60,
    "freeAmount": 100000
  }
}
```

### Field Descriptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `scheduleId` | string (ObjectId) | ✅ | ID của lịch đặt phòng |
| `roomId` | string (ObjectId) | ✅ | ID của phòng |
| `totalAmount` | number | ✅ | Tổng tiền (VNĐ) |
| `items` | array | ✅ | Chi tiết các item trong bill |
| `customerPhone` | string | ⭐ | Số điện thoại khách (để tích điểm) |
| `paymentMethod` | string | ✅ | Phương thức thanh toán |
| `startTime` | string (ISO) | ❌ | Thời gian bắt đầu |
| `endTime` | string (ISO) | ❌ | Thời gian kết thúc |
| `invoiceCode` | string | ❌ | Mã hóa đơn (auto generate nếu không có) |
| `note` | string | ❌ | Ghi chú |
| `gift` | object | ❌ | Thông tin gift (nếu có) |
| `activePromotion` | object | ❌ | Khuyến mãi đang áp dụng |
| `freeHourPromotion` | object | ❌ | Giờ đầu miễn phí |

---

## 📊 Response Format

### Success Response (200 OK)

#### Case 1: Tích điểm thành công

```json
{
  "message": "Bill saved successfully and membership points added",
  "result": {
    "bill": {
      "_id": "507f1f77bcf86cd799439011",
      "scheduleId": "507f1f77bcf86cd799439012",
      "roomId": "507f191e810c19729de860ea",
      "customerPhone": "0987654321",
      "totalAmount": 250000,
      "invoiceCode": "#07021430",
      "paymentMethod": "cash",
      "items": [...],
      "startTime": "2026-02-07T14:00:00.000Z",
      "endTime": "2026-02-07T16:00:00.000Z",
      "createdAt": "2026-02-07T16:05:00.000Z"
    },
    "membership": {
      "success": true,
      "user": {
        "_id": "507f1f77bcf86cd799439013",
        "phone_number": "0987654321",
        "name": "Nguyen Van A",
        "totalPoint": 2750,
        "availablePoint": 2750,
        "lifetimePoint": 2750,
        "tier": "Member"
      }
    }
  }
}
```

#### Case 2: Bill lưu thành công, không tích điểm (không có phone)

```json
{
  "message": "Bill saved successfully (membership skipped: Không có phone_number trong bill hoặc schedule)",
  "result": {
    "bill": {
      "_id": "507f1f77bcf86cd799439011",
      "scheduleId": "507f1f77bcf86cd799439012",
      "roomId": "507f191e810c19729de860ea",
      "totalAmount": 250000,
      "invoiceCode": "#07021430",
      "items": [...]
    },
    "membership": {
      "success": false,
      "skipped": true,
      "reason": "Không có phone_number trong bill hoặc schedule"
    }
  }
}
```

#### Case 3: Bill lưu thành công, lỗi tích điểm

```json
{
  "message": "Bill saved successfully (membership error: Không tìm thấy user với số điện thoại 0987654321)",
  "result": {
    "bill": {
      "_id": "507f1f77bcf86cd799439011",
      "scheduleId": "507f1f77bcf86cd799439012",
      "roomId": "507f191e810c19729de860ea",
      "customerPhone": "0987654321",
      "totalAmount": 250000,
      "invoiceCode": "#07021430",
      "items": [...]
    },
    "membership": {
      "success": false,
      "error": "Không tìm thấy user với số điện thoại 0987654321"
    }
  }
}
```

### Error Response (400 Bad Request)

```json
{
  "message": "Missing required bill fields (scheduleId, roomId)",
  "error": "Missing required bill fields (scheduleId, roomId)"
}
```

---

## 🧪 Test Cases

### Test 1: Save bill với tích điểm thành công

**Prerequisites:**
- Có user với phone_number = "0987654321"
- Có schedule và room hợp lệ

**Request:**
```bash
curl -X POST http://localhost:4000/api/bill/save \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "scheduleId": "507f1f77bcf86cd799439011",
    "roomId": "507f191e810c19729de860ea",
    "totalAmount": 250000,
    "customerPhone": "0987654321",
    "paymentMethod": "cash",
    "items": [
      {
        "description": "Phi dich vu thu am",
        "quantity": 2,
        "price": 100000,
        "totalPrice": 200000
      }
    ]
  }'
```

**Expected Result:**
- ✅ Bill được lưu vào DB
- ✅ User được cộng 250 điểm (250,000 / 1,000 * 1)
- ✅ Streak count tăng +1
- ✅ Nếu đủ mốc streak (3, 5, 10): cộng điểm thưởng
- ✅ Response trả về `membership.success = true`

---

### Test 2: Save bill không có customerPhone

**Request:**
```bash
curl -X POST http://localhost:4000/api/bill/save \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "scheduleId": "507f1f77bcf86cd799439011",
    "roomId": "507f191e810c19729de860ea",
    "totalAmount": 250000,
    "paymentMethod": "cash",
    "items": [...]
  }'
```

**Expected Result:**
- ✅ Bill được lưu vào DB
- ❌ Không tích điểm (skip)
- ✅ Response: `membership.skipped = true`
- ✅ Message: "Bill saved successfully (membership skipped: ...)"

---

### Test 3: Save bill với phone không tồn tại

**Request:**
```bash
curl -X POST http://localhost:4000/api/bill/save \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "scheduleId": "507f1f77bcf86cd799439011",
    "roomId": "507f191e810c19729de860ea",
    "totalAmount": 250000,
    "customerPhone": "0999999999",
    "paymentMethod": "cash",
    "items": [...]
  }'
```

**Expected Result:**
- ✅ Bill được lưu vào DB
- ❌ Tích điểm thất bại (user không tồn tại)
- ✅ Response: `membership.error = "Không tìm thấy user..."`
- ✅ Message: "Bill saved successfully (membership error: ...)"

---

### Test 4: Save bill với totalAmount = 0

**Request:**
```bash
curl -X POST http://localhost:4000/api/bill/save \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "scheduleId": "507f1f77bcf86cd799439011",
    "roomId": "507f191e810c19729de860ea",
    "totalAmount": 0,
    "customerPhone": "0987654321",
    "paymentMethod": "cash",
    "items": []
  }'
```

**Expected Result:**
- ✅ Bill được lưu vào DB
- ❌ Không tích điểm (totalAmount = 0)
- ✅ Response: `membership.skipped = true`
- ✅ Message: "Bill saved successfully (membership skipped: Tổng tiền = 0, không tích điểm)"

---

### Test 5: Save bill 2 lần với cùng invoiceCode (test tránh trùng)

**Request 1:**
```bash
curl -X POST http://localhost:4000/api/bill/save \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "scheduleId": "507f1f77bcf86cd799439011",
    "roomId": "507f191e810c19729de860ea",
    "totalAmount": 250000,
    "customerPhone": "0987654321",
    "invoiceCode": "#TEST1234",
    "paymentMethod": "cash",
    "items": [...]
  }'
```

**Request 2:** (Gọi lại với cùng invoiceCode)
```bash
# Gọi lại API với cùng body
```

**Expected Result:**
- ✅ Lần 1: Tích điểm thành công
- ❌ Lần 2: Skip tích điểm (invoice đã tích điểm rồi)
- ✅ Response lần 2: `membership.skipped = true`
- ✅ Message: "...membership skipped: Invoice đã được tích điểm rồi"

---

## 🎯 Frontend Integration Guide

### Step 1: Lấy access token

```javascript
// Login để lấy token
const loginResponse = await fetch('http://localhost:4000/api/users/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'staff@example.com',
    password: 'password123'
  })
})

const { result } = await loginResponse.json()
const accessToken = result.accessToken
```

### Step 2: Save bill với customerPhone

```javascript
const saveBill = async (billData) => {
  try {
    const response = await fetch('http://localhost:4000/api/bill/save', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        scheduleId: billData.scheduleId,
        roomId: billData.roomId,
        totalAmount: billData.totalAmount,
        customerPhone: billData.customerPhone, // ⭐ Quan trọng để tích điểm
        paymentMethod: billData.paymentMethod,
        items: billData.items
      })
    })

    const result = await response.json()
    
    // Check kết quả membership
    if (result.result.membership.success) {
      console.log('✅ Tích điểm thành công!')
      console.log('Điểm hiện tại:', result.result.membership.user.totalPoint)
      console.log('Streak:', result.result.membership.user.streakCount)
    } else if (result.result.membership.skipped) {
      console.log('⚠️ Bỏ qua tích điểm:', result.result.membership.reason)
    } else if (result.result.membership.error) {
      console.log('❌ Lỗi tích điểm:', result.result.membership.error)
    }
    
    return result
  } catch (error) {
    console.error('Error saving bill:', error)
    throw error
  }
}
```

### Step 3: Handle response

```javascript
// Ví dụ sử dụng
const bill = {
  scheduleId: '507f1f77bcf86cd799439011',
  roomId: '507f191e810c19729de860ea',
  totalAmount: 250000,
  customerPhone: '0987654321',
  paymentMethod: 'cash',
  items: [
    {
      description: 'Phi dich vu thu am',
      quantity: 2,
      price: 100000,
      totalPrice: 200000
    }
  ]
}

const result = await saveBill(bill)

// Hiển thị kết quả cho user
if (result.result.membership.success) {
  alert(`Thanh toán thành công! Bạn được cộng ${result.result.membership.user.totalPoint} điểm`)
} else {
  alert('Thanh toán thành công!')
}
```

---

## 🔍 Debugging Tips

### 1. Check logs

Server sẽ log các thông tin quan trọng:
```
✅ Bill lưu thành công
✅ Tìm thấy user với phone 0987654321
✅ Cộng 250 điểm
✅ Streak count: 3 → 4
✅ Đạt mốc streak 3, cộng điểm thưởng 100đ
```

### 2. Check database

**Bills collection:**
```javascript
db.bills.findOne({ invoiceCode: "#07021430" })
```

**RewardHistories collection:**
```javascript
db.rewardHistories.find({ 
  'meta.invoiceCode': '#07021430' 
}).pretty()
```

**Streaks collection:**
```javascript
db.streaks.findOne({ 
  userId: ObjectId("507f1f77bcf86cd799439013") 
})
```

**Users collection:**
```javascript
db.users.findOne({ 
  phone_number: "0987654321" 
})
```

### 3. Common Issues

**Issue 1: "Missing required bill fields"**
- ✅ Kiểm tra có đủ `scheduleId`, `roomId` không
- ✅ Kiểm tra format ObjectId đúng không

**Issue 2: "Không tìm thấy user"**
- ✅ Kiểm tra phone_number có trong users collection không
- ✅ Kiểm tra format phone đúng không (0987654321 vs +84987654321)

**Issue 3: "Unauthorized"**
- ✅ Kiểm tra có truyền Authorization header không
- ✅ Kiểm tra token còn hạn không
- ✅ Kiểm tra role là Admin hoặc Staff

**Issue 4: Tích điểm không thành công**
- ✅ Check `customerPhone` có được truyền không
- ✅ Check user có tồn tại với phone đó không
- ✅ Check `totalAmount > 0` không

---

## 📱 Postman Collection

### Import collection

```json
{
  "info": {
    "name": "Bill & Membership API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "Save Bill (Success)",
      "request": {
        "method": "POST",
        "header": [
          {
            "key": "Authorization",
            "value": "Bearer {{accessToken}}",
            "type": "text"
          },
          {
            "key": "Content-Type",
            "value": "application/json",
            "type": "text"
          }
        ],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"scheduleId\": \"{{scheduleId}}\",\n  \"roomId\": \"{{roomId}}\",\n  \"totalAmount\": 250000,\n  \"customerPhone\": \"0987654321\",\n  \"paymentMethod\": \"cash\",\n  \"items\": [\n    {\n      \"description\": \"Phi dich vu thu am\",\n      \"quantity\": 2,\n      \"price\": 100000,\n      \"totalPrice\": 200000\n    }\n  ]\n}"
        },
        "url": {
          "raw": "{{baseUrl}}/api/bill/save",
          "host": [
            "{{baseUrl}}"
          ],
          "path": [
            "api",
            "bill",
            "save"
          ]
        }
      }
    }
  ],
  "variable": [
    {
      "key": "baseUrl",
      "value": "http://localhost:4000"
    },
    {
      "key": "accessToken",
      "value": "YOUR_TOKEN_HERE"
    }
  ]
}
```

---

## 🎓 Summary

### FE cần làm gì:

1. ✅ **Login** để lấy access token (Admin/Staff)
2. ✅ **Collect bill data** từ UI
3. ✅ **Thêm customerPhone** vào bill data (nếu có)
4. ✅ **Call API** `POST /api/bill/save` với data
5. ✅ **Handle response** - check `membership` object
6. ✅ **Show notification** cho user về điểm thưởng

### BE tự động làm gì:

1. ✅ Lưu bill vào database
2. ✅ Tạo invoiceCode (nếu chưa có)
3. ✅ Tìm user theo phone_number
4. ✅ Cộng điểm theo totalAmount
5. ✅ Cập nhật streak count (+1)
6. ✅ Cộng điểm thưởng streak (nếu đạt mốc)
7. ✅ Kiểm tra lên hạng tier
8. ✅ Tự động tặng tier gifts (nếu lên hạng)
9. ❌ **KHÔNG** tự động tặng streak gifts (phải manual)

### Lưu ý quan trọng:

- 📞 **customerPhone** là field quan trọng nhất để tích điểm
- 💾 Bill luôn được lưu, dù có lỗi tích điểm
- 🎁 Streak gifts phải staff manually claim sau
- 🔄 Tránh tích điểm trùng bằng invoiceCode
- ✅ Check response.membership để biết kết quả tích điểm
