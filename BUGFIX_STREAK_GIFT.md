# BUG FIX - Streak Gift không tự động assign

## 🐛 Vấn đề

Khi user đạt streak count = 3:
1. ✅ Điểm thưởng được tự động cộng (correct)
2. ✅ Gift KHÔNG được tự động assign (correct)
3. ❌ **BUG:** API `getPendingAndEligibleGifts` không hiển thị gift trong `eligible` list

### Nguyên nhân

Code đang check `alreadyClaimed/alreadyAssigned` **KHÔNG phân biệt** giữa:
- Record điểm thưởng (points)
- Record gift

Khi user đạt streak = 3:
```javascript
// ✅ Code TẠO record điểm thưởng
await this.addRewardHistory(userId, 100, RewardSource.Streak, {
  method: 'auto',
  streakCount: 3
})
// Record: { points: 100, source: 'Streak', meta: { streakCount: 3 } }

// ❌ Sau đó getPendingAndEligibleGifts check:
const alreadyAssigned = await rewardHistories.findOne({
  userId,
  source: 'Streak',
  'meta.streakCount': 3
  // ❌ Tìm thấy record điểm thưởng ở trên
  // ❌ Nghĩ là gift đã assigned → KHÔNG thêm vào eligible
})
```

## ✅ Fix

### Fix 1: updateStreak() - Tách check điểm và gift

**Before:**
```typescript
const alreadyClaimed = await rewardHistories.findOne({
  userId,
  source: RewardSource.Streak,
  'meta.streakCount': reward.count
  // ❌ Tìm thấy cả record điểm thưởng lẫn gift
})

if (alreadyClaimed) {
  continue // ❌ Skip cả điểm lẫn gift
}
```

**After:**
```typescript
// ✅ CHỈ check điểm thưởng
if (reward.bonusPoints > 0) {
  const alreadyClaimedPoints = await rewardHistories.findOne({
    userId,
    source: RewardSource.Streak,
    'meta.streakCount': reward.count,
    points: { $gt: 0 } // ⭐ CHỈ check record có điểm
  })

  if (!alreadyClaimedPoints) {
    // Cộng điểm thưởng
  }
}

// ✅ Gift không check gì cả, chỉ log
if (reward.giftId) {
  console.log('User đủ điều kiện nhận gift')
}
```

### Fix 2: getPendingAndEligibleGifts() - Chỉ check gift records

**Before:**
```typescript
const alreadyAssigned = await rewardHistories.findOne({
  userId,
  source: RewardSource.Streak,
  'meta.streakCount': reward.count
  // ❌ Tìm thấy cả record điểm thưởng
})
```

**After:**
```typescript
const alreadyAssigned = await rewardHistories.findOne({
  userId,
  source: RewardSource.Streak,
  'meta.streakCount': reward.count,
  rewardType: 'gift' // ⭐ CHỈ check gift, không check điểm
})
```

## 📊 Database Records Example

### Streak = 3 với config: bonusPoints=100, giftId="abc"

**Sau khi thanh toán (saveBill):**

```javascript
// ✅ Record điểm thưởng (tự động)
{
  _id: ObjectId("..."),
  userId: ObjectId("123"),
  points: 100,
  source: "Streak",
  rewardType: undefined, // ⭐ Không có rewardType
  meta: {
    streakCount: 3,
    method: "auto"
  }
}

// ❌ KHÔNG có record gift (chưa assign)
```

**Sau khi staff claim gift:**

```javascript
// ✅ Record điểm thưởng (từ trước)
{
  _id: ObjectId("..."),
  userId: ObjectId("123"),
  points: 100,
  source: "Streak",
  meta: { streakCount: 3 }
}

// ✅ Record gift (mới assign)
{
  _id: ObjectId("..."),
  userId: ObjectId("123"),
  points: 0,
  source: "Streak",
  rewardType: "gift", // ⭐ Có rewardType = 'gift'
  giftStatus: "claimed",
  meta: {
    streakCount: 3,
    giftId: ObjectId("abc"),
    giftName: "Trà sữa M"
  }
}
```

## 🧪 Test Flow

### Test Case: User đạt streak = 3

**Step 1: Thanh toán**
```bash
POST /api/bill/save
Body: {
  customerPhone: "0987654321",
  totalAmount: 250000,
  ...
}
```

**Expected:**
- ✅ Cộng 250 điểm
- ✅ Streak: 2 → 3
- ✅ Cộng điểm thưởng: +100đ
- ✅ Database: 1 record (points=100)

**Step 2: Check eligible gifts**
```bash
GET /api/membership/gifts/pending-eligible?userIdOrPhone=0987654321
```

**Expected:**
```json
{
  "user": { "streakCount": 3 },
  "pending": [],
  "eligible": [
    {
      "streakCount": 3,
      "giftName": "Trà sữa M",
      "bonusPoints": 100
    }
  ]
}
```

**Before Fix:** `eligible: []` ❌  
**After Fix:** `eligible: [{ streakCount: 3, ... }]` ✅

**Step 3: Staff claim gift**
```bash
POST /api/membership/gifts/claim-streak
Body: {
  userIdOrPhone: "0987654321",
  streakCount: 3,
  ...
}
```

**Expected:**
- ✅ Assign gift (create record rewardType='gift')
- ✅ Trừ tồn kho
- ✅ Database: 2 records (points + gift)

**Step 4: Check lại eligible**
```bash
GET /api/membership/gifts/pending-eligible?userIdOrPhone=0987654321
```

**Expected:**
```json
{
  "pending": [],
  "eligible": [] // ✅ Không còn eligible vì đã claimed
}
```

## 🔍 Query để Debug

### Check tất cả records cho user
```javascript
db.rewardHistories.find({
  userId: ObjectId("123"),
  source: "Streak"
}).pretty()
```

### Check chỉ điểm thưởng
```javascript
db.rewardHistories.find({
  userId: ObjectId("123"),
  source: "Streak",
  points: { $gt: 0 }
}).pretty()
```

### Check chỉ gifts
```javascript
db.rewardHistories.find({
  userId: ObjectId("123"),
  source: "Streak",
  rewardType: "gift"
}).pretty()
```

## ✅ Kết luận

### Changes:

1. ✅ **updateStreak()**: Tách riêng check điểm và gift
   - Điểm: check `points > 0`
   - Gift: không check gì, chỉ log

2. ✅ **getPendingAndEligibleGifts()**: Chỉ check gift records
   - Thêm filter `rewardType: 'gift'`

3. ✅ **Database**: Phân biệt rõ 2 loại records
   - Points record: `{ points: 100, rewardType: undefined }`
   - Gift record: `{ points: 0, rewardType: 'gift', giftStatus: 'claimed' }`

### Result:

- ✅ Điểm thưởng tự động cộng ngay
- ✅ Gift vẫn hiện trong eligible sau khi đạt mốc
- ✅ Staff có thể claim gift bất cứ lúc nào
- ✅ Sau khi claim, gift không còn trong eligible
