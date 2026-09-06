import { Request, Response, NextFunction } from 'express'
import fnBMenuItemService from '~/services/fnbMenuItem.service'
import databaseService from '~/services/database.service'
import type { ClientSession } from 'mongodb'
import { FnBMenuItem } from '~/models/schemas/FnBMenuItem.schema'
import { HttpStatusCode } from 'axios'
import { uploadImageToCloudinary } from '~/services/cloudinary.service'
import { FnBCategory, RevenueCategory, UserRole } from '~/constants/enum'
import { ErrorWithStatus } from '~/models/Error'
import {
  parseCustomizationGroups,
  parseCustomizationOverrides,
  parseCustomizationTemplateRefs
} from '~/services/fnbMenuCustomization.service'

function resolveCustomizationGroupsInput(raw: unknown): FnBMenuItem['customizationGroups'] | undefined {
  if (raw === undefined) return undefined
  if (raw === null || raw === '') return []
  return parseCustomizationGroups(raw) ?? []
}

function resolveCustomizationTemplateRefsInput(raw: unknown): FnBMenuItem['customizationTemplateRefs'] | undefined {
  if (raw === undefined) return undefined
  if (raw === null || raw === '') return []
  return parseCustomizationTemplateRefs(raw) ?? []
}

function resolveCustomizationOverridesInput(raw: unknown): FnBMenuItem['customizationOverrides'] | undefined {
  if (raw === undefined) return undefined
  if (raw === null || raw === '') return []
  return parseCustomizationOverrides(raw) ?? []
}

function applyCustomizationConfig(target: Partial<FnBMenuItem>, source: Record<string, unknown>) {
  const groups = resolveCustomizationGroupsInput(source.customizationGroups)
  if (groups !== undefined) target.customizationGroups = groups
  const refs = resolveCustomizationTemplateRefsInput(source.customizationTemplateRefs)
  if (refs !== undefined) target.customizationTemplateRefs = refs
  const overrides = resolveCustomizationOverridesInput(source.customizationOverrides)
  if (overrides !== undefined) target.customizationOverrides = overrides
}

function parseIsActive(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return undefined
  const normalized = value.toLowerCase()
  if (normalized === 'true' || normalized === '1') return true
  if (normalized === 'false' || normalized === '0') return false
  return undefined
}

function parseRevenueCategory(value: unknown): RevenueCategory | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0 || !Object.values(RevenueCategory).includes(value as RevenueCategory)) {
    throw new ErrorWithStatus({ message: 'Revenue category không hợp lệ', status: HttpStatusCode.BadRequest })
  }
  return value as RevenueCategory
}

function parseInventoryTracked(value: unknown): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  throw new ErrorWithStatus({ message: 'inventoryTracked phải là boolean', status: HttpStatusCode.BadRequest })
}

async function buildMenuItemsListResponse(
  fetchItems: () => Promise<FnBMenuItem[]>,
  fetchVariants: (parentId: string) => Promise<FnBMenuItem[]>
) {
  const result = await fetchItems()
  const parsedResult = result.map((item) => {
    if (item.hasVariant) {
      return fetchVariants(item._id!.toString()).then((variants) => ({
        ...item,
        variants
      }))
    }
    return {
      ...item,
      variants: []
    }
  })

  return Promise.all(parsedResult)
}

// Tạo mới menu item
export const createMenuItem = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body
    const files = req.files as Express.Multer.File[]

    console.log('=== CREATE MENU ITEM DEBUG ===')
    console.log('Body:', JSON.stringify(body, null, 2))
    console.log('Files count:', files?.length || 0)
    console.log(
      'File fieldnames:',
      files?.map((f) => f.fieldname)
    )

    // Chuẩn hóa hasVariant từ string sang boolean
    const hasVariant = body.hasVariant === 'true' || body.hasVariant === true

    // Validate category
    if (body.category && !Object.values(FnBCategory).includes(body.category as FnBCategory)) {
      return res.status(HttpStatusCode.BadRequest).json({
        message: 'Category phải là "snack" hoặc "drink"'
      })
    }

    // Nếu có variants, parse and validate the complete request before any database insert.
    if (Object.prototype.hasOwnProperty.call(body, 'variants') && hasVariant) {
      let variantsData: Array<Record<string, any>>
      try {
        variantsData = typeof body.variants === 'string' ? JSON.parse(body.variants) : body.variants
      } catch {
        throw new ErrorWithStatus({ message: 'Invalid variants JSON format', status: HttpStatusCode.BadRequest })
      }
      if (!Array.isArray(variantsData)) {
        throw new ErrorWithStatus({ message: 'Variants must be an array', status: HttpStatusCode.BadRequest })
      }

      const parentRevenueCategory = parseRevenueCategory(body.revenueCategory)
      const parentInventoryTracked = parseInventoryTracked(body.inventoryTracked)
      const normalizedVariants = variantsData.map((variant) => {
        if (!variant || typeof variant !== 'object' || typeof variant.name !== 'string' || !variant.name.trim()) {
          throw new ErrorWithStatus({ message: 'Variant không hợp lệ', status: HttpStatusCode.BadRequest })
        }
        const normalized = { ...variant }
        normalized.revenueCategory = parseRevenueCategory(
          Object.prototype.hasOwnProperty.call(variant, 'revenueCategory')
            ? variant.revenueCategory
            : body.revenueCategory
        )
        normalized.inventoryTracked = parseInventoryTracked(
          Object.prototype.hasOwnProperty.call(variant, 'inventoryTracked')
            ? variant.inventoryTracked
            : body.inventoryTracked
        )
        const active = parseIsActive(variant.isActive) ?? true
        if (active && (!normalized.revenueCategory || normalized.inventoryTracked === undefined)) {
          throw new ErrorWithStatus({
            message: 'Variant đang bán phải có revenueCategory và inventoryTracked',
            status: HttpStatusCode.BadRequest
          })
        }
        return normalized
      })

      const now = new Date()
      const parentItem: FnBMenuItem = {
        name: body.name,
        parentId: null,
        hasVariant: true,
        price: 0,
        category: (body.category as FnBCategory) || FnBCategory.SNACK,
        revenueCategory: parentRevenueCategory,
        inventoryTracked: parentInventoryTracked,
        inventory: { quantity: 0, lastUpdated: now },
        isActive: parseIsActive(body.isActive) ?? true,
        createdAt: now,
        updatedAt: now
      }
      applyCustomizationConfig(parentItem, body as Record<string, unknown>)

      const variantItems = normalizedVariants.map((variant) => {
        const variantItem: FnBMenuItem = {
          name: variant.name,
          parentId: '',
          hasVariant: false,
          price: Number(variant.price),
          category: (variant.category as FnBCategory) || (body.category as FnBCategory) || FnBCategory.SNACK,
          revenueCategory: variant.revenueCategory,
          inventoryTracked: variant.inventoryTracked,
          inventory: {
            quantity: Number(variant.inventory?.quantity || variant.inventory || 0),
            minStock: variant.inventory?.minStock ? Number(variant.inventory.minStock) : undefined,
            maxStock: variant.inventory?.maxStock ? Number(variant.inventory.maxStock) : undefined,
            lastUpdated: now
          },
          isActive: parseIsActive(variant.isActive) ?? true,
          createdAt: now,
          updatedAt: now
        }
        applyCustomizationConfig(variantItem, variant as Record<string, unknown>)
        return variantItem
      })

      const mainImageFile = files?.[0]
      if (mainImageFile) {
        const uploadResult = (await uploadImageToCloudinary(mainImageFile.buffer, 'menu-items')) as {
          url: string
          publicId: string
        }
        parentItem.image = uploadResult.url
      }
      for (let i = 0; i < variantItems.length; i++) {
        const variantFile = files?.find((file) => file.fieldname === `variantFile_${i}`)
        if (variantFile) {
          const uploadResult = (await uploadImageToCloudinary(variantFile.buffer, 'menu-items/variants')) as {
            url: string
            publicId: string
          }
          variantItems[i].image = uploadResult.url
        }
      }

      const result = await databaseService.withTransaction(async (session) => {
        const parent = await fnBMenuItemService.createMenuItem(parentItem, session)
        const parentId = parent._id?.toString() || ''
        const variants = []
        for (const variantItem of variantItems) {
          variantItem.parentId = parentId
          variants.push(await fnBMenuItemService.createMenuItem(variantItem, session))
        }
        return { parent, variants }
      })

      return res.status(HttpStatusCode.Created).json({
        message: 'Tạo menu item với variants thành công',
        result
      })
    }

    // Tạo sản phẩm đơn (không có variants)
    let imageUrl = ''
    if (files && files.length > 0) {
      const uploadResult = (await uploadImageToCloudinary(files[0].buffer, 'menu-items')) as {
        url: string
        publicId: string
      }
      imageUrl = uploadResult.url
    }

    const item: FnBMenuItem = {
      name: body.name,
      parentId: body.parentId || null,
      hasVariant,
      price: Number(body.price),
      image: imageUrl || undefined,
      category: (body.category as FnBCategory) || FnBCategory.SNACK,
      revenueCategory: parseRevenueCategory(body.revenueCategory),
      inventoryTracked: parseInventoryTracked(body.inventoryTracked),
      inventory: {
        quantity: Number(body.quantity),
        minStock: body.minStock ? Number(body.minStock) : undefined,
        maxStock: body.maxStock ? Number(body.maxStock) : undefined,
        lastUpdated: new Date()
      },
      isActive: parseIsActive(body.isActive) ?? true,
      createdAt: new Date(),
      updatedAt: new Date()
    }
    applyCustomizationConfig(item, body as Record<string, unknown>)
    const result = await fnBMenuItemService.createMenuItem(item)
    return res.status(HttpStatusCode.Created).json({ message: 'Tạo menu item thành công', result })
  } catch (error) {
    next(error)
  }
}

// Tạo mới menu item với variants through the same pre-validation and atomic create path.
export const createMenuItemWithVariants = async (req: Request, res: Response, next: NextFunction) => {
  req.body.hasVariant = true
  return createMenuItem(req, res, next)
}

// Lấy 1 menu item theo id
export const getMenuItemById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    console.log('Getting menu item with ID:', id)

    const result = await fnBMenuItemService.getMenuItemById(id)
    if (!result) return res.status(HttpStatusCode.NotFound).json({ message: 'Không tìm thấy menu item' })

    console.log('Original result:', JSON.stringify(result, null, 2))
    console.log('hasVariant:', result.hasVariant)
    console.log('Type of hasVariant:', typeof result.hasVariant)

    // Nếu là sản phẩm cha có variants, lấy thêm variants
    if (result.hasVariant) {
      console.log('This is a parent item with variants, fetching variants...')
      const variants = await fnBMenuItemService.getVariantsByParentId(id)
      console.log('Found variants:', JSON.stringify(variants, null, 2))
      console.log('Number of variants:', variants.length)

      const response = {
        ...result,
        variants: variants
      }

      console.log('Final response with variants:', JSON.stringify(response, null, 2))

      return res.status(HttpStatusCode.Ok).json({
        message: 'Lấy menu item thành công',
        result: response
      })
    }

    // Nếu không có variants, trả về item đơn với variants rỗng
    const response = {
      ...result,
      variants: []
    }

    console.log('Final response (no variants):', JSON.stringify(response, null, 2))

    return res.status(HttpStatusCode.Ok).json({
      message: 'Lấy menu item thành công',
      result: response
    })
  } catch (error) {
    console.error('Error in getMenuItemById:', error)
    next(error)
  }
}

// Lấy tất cả menu item (bao gồm cả inactive — FE lọc theo isActive khi cần)
export const getAllMenuItems = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { category } = req.query

    const finalResult = await buildMenuItemsListResponse(
      () =>
        category && Object.values(FnBCategory).includes(category as FnBCategory)
          ? fnBMenuItemService.getMenuItemsByCategory(category as FnBCategory)
          : fnBMenuItemService.getRootMenuItems(),
      (parentId) => fnBMenuItemService.getVariantsByParentId(parentId)
    )

    return res.status(HttpStatusCode.Ok).json({
      message: 'Lấy menu items thành công',
      result: finalResult
    })
  } catch (error) {
    next(error)
  }
}

// Lấy tất cả menu item cho admin (bao gồm inactive)
export const getAllMenuItemsManage = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { category } = req.query

    const finalResult = await buildMenuItemsListResponse(
      () =>
        category && Object.values(FnBCategory).includes(category as FnBCategory)
          ? fnBMenuItemService.getMenuItemsByCategory(category as FnBCategory)
          : fnBMenuItemService.getRootMenuItems(),
      (parentId) => fnBMenuItemService.getVariantsByParentId(parentId)
    )

    return res.status(HttpStatusCode.Ok).json({
      message: 'Lấy menu items thành công',
      result: finalResult
    })
  } catch (error) {
    next(error)
  }
}

// Lấy menu item với variants
export const getMenuItemWithVariants = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const parentItem = await fnBMenuItemService.getMenuItemById(id)

    if (!parentItem) {
      return res.status(HttpStatusCode.NotFound).json({ message: 'Không tìm thấy menu item' })
    }

    // Nếu không phải sản phẩm cha có variants, trả về item đơn
    if (!parentItem.hasVariant) {
      return res.status(HttpStatusCode.Ok).json({
        result: {
          ...parentItem,
          variants: []
        }
      })
    }

    // Lấy tất cả variants của sản phẩm cha
    const variants = await fnBMenuItemService.getVariantsByParentId(id)

    return res.status(HttpStatusCode.Ok).json({
      result: {
        ...parentItem,
        variants: variants
      }
    })
  } catch (error) {
    next(error)
  }
}

// Cập nhật menu item
export const updateMenuItem = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const body = req.body
    const files = req.files as Express.Multer.File[]

    console.log('=== UPDATE MENU ITEM DEBUG ===')
    console.log('Body:', JSON.stringify(body, null, 2))
    console.log('Files count:', files?.length || 0)

    // Parse and validate the complete variant payload before any database mutation.
    let parsedVariants: Array<Record<string, any>> | undefined
    if (Object.prototype.hasOwnProperty.call(body, 'variants')) {
      try {
        parsedVariants = typeof body.variants === 'string' ? JSON.parse(body.variants) : body.variants
      } catch {
        throw new ErrorWithStatus({ message: 'Invalid variants JSON format', status: HttpStatusCode.BadRequest })
      }
      if (!Array.isArray(parsedVariants)) {
        throw new ErrorWithStatus({ message: 'Variants must be an array', status: HttpStatusCode.BadRequest })
      }
      parsedVariants = parsedVariants.map((variant) => {
        if (!variant || typeof variant !== 'object' || typeof variant.name !== 'string' || !variant.name.trim()) {
          throw new ErrorWithStatus({ message: 'Variant không hợp lệ', status: HttpStatusCode.BadRequest })
        }
        const normalized = { ...variant }
        if (Object.prototype.hasOwnProperty.call(variant, 'revenueCategory')) {
          normalized.revenueCategory = parseRevenueCategory(variant.revenueCategory)
        } else if (Object.prototype.hasOwnProperty.call(body, 'revenueCategory')) {
          normalized.revenueCategory = parseRevenueCategory(body.revenueCategory)
        }
        if (Object.prototype.hasOwnProperty.call(variant, 'inventoryTracked')) {
          normalized.inventoryTracked = parseInventoryTracked(variant.inventoryTracked)
        } else if (Object.prototype.hasOwnProperty.call(body, 'inventoryTracked')) {
          normalized.inventoryTracked = parseInventoryTracked(body.inventoryTracked)
        }
        return normalized
      })
      body.variants = parsedVariants
    }

    const hasRevenueCategoryInput = Object.prototype.hasOwnProperty.call(body, 'revenueCategory')
    const classificationContext = hasRevenueCategoryInput
      ? {
          actorId: req.decoded_authorization?.user_id ?? '',
          actorRole: UserRole.Admin,
          reason: typeof body.reason === 'string' ? body.reason.trim() : ''
        }
      : undefined

    // Chuẩn hóa hasVariant nếu có
    let updateData: Partial<FnBMenuItem> = { ...body }
    delete (updateData as Record<string, unknown>).reason
    if (hasRevenueCategoryInput) updateData.revenueCategory = parseRevenueCategory(body.revenueCategory)
    if (body.inventoryTracked !== undefined) {
      updateData.inventoryTracked = parseInventoryTracked(body.inventoryTracked)
    }
    if (body.hasVariant !== undefined) {
      updateData.hasVariant = body.hasVariant === 'true' || body.hasVariant === true
    }
    if (body.price !== undefined) updateData.price = Number(body.price)
    if (body.isActive !== undefined) {
      const parsedIsActive = parseIsActive(body.isActive)
      if (parsedIsActive !== undefined) updateData.isActive = parsedIsActive
    }
    if (body.quantity !== undefined) {
      updateData.inventory = {
        ...(updateData.inventory || {}),
        quantity: Number(body.quantity),
        lastUpdated: new Date()
      }
    }

    // FormData có thể gửi quantity/existingImage top-level — không lưu vào document menu item
    delete (updateData as Record<string, unknown>).quantity
    delete (updateData as Record<string, unknown>).existingImage
    delete (updateData as Record<string, unknown>).customizationGroups
    delete (updateData as Record<string, unknown>).customizationTemplateRefs
    delete (updateData as Record<string, unknown>).customizationOverrides
    delete (updateData as Record<string, unknown>).variants
    applyCustomizationConfig(updateData, body as Record<string, unknown>)

    // Upload ảnh mới lên Cloudinary nếu có file, hoặc giữ ảnh cũ nếu có existingImage
    if (files && files.length > 0) {
      const uploadResult = (await uploadImageToCloudinary(files[0].buffer, 'menu-items')) as {
        url: string
        publicId: string
      }
      updateData.image = uploadResult.url
    } else if (body.existingImage) {
      // Giữ lại ảnh cũ nếu không upload ảnh mới
      updateData.image = body.existingImage
    }

    const persist = async (session?: ClientSession) => {
      let existingVariants: FnBMenuItem[] = []
      if (parsedVariants) {
        // This snapshot is decisive for ownership checks, deletion, and stable-ID/name matching.
        existingVariants = await fnBMenuItemService.getVariantsByParentId(id, session)
        for (const variant of parsedVariants) {
          const existing = variant._id
            ? existingVariants.find((candidate) => candidate._id?.toString() === String(variant._id))
            : existingVariants.find((candidate) => candidate.name === variant.name)
          if (variant._id && !existing) {
            throw new ErrorWithStatus({ message: 'Variant không thuộc sản phẩm cha', status: HttpStatusCode.BadRequest })
          }
          const active = parseIsActive(variant.isActive) ?? existing?.isActive ?? true
          if (!existing && active && (!variant.revenueCategory || variant.inventoryTracked === undefined)) {
            throw new ErrorWithStatus({
              message: 'Variant mới/đổi tên phải có revenueCategory và inventoryTracked',
              status: HttpStatusCode.BadRequest
            })
          }
        }
      }

      // Cập nhật sản phẩm cha only after transaction-scoped variant validation.
      const result = await fnBMenuItemService.updateMenuItem(id, updateData, classificationContext, session)
    if (!result) return null

    // Nếu có variants trong payload, cập nhật từng variant
    if (body.variants) {
      console.log('=== STARTING VARIANT UPDATE ===')
      console.log('Updating variants, raw data:', body.variants)
      console.log('Type of variants:', typeof body.variants)

      const variants = []
      let variantsData

      // Parse variants từ string JSON hoặc array
      if (typeof body.variants === 'string') {
        try {
          variantsData = JSON.parse(body.variants)
        } catch (error) {
          console.error('Error parsing variants JSON:', error)
          return res.status(HttpStatusCode.BadRequest).json({
            message: 'Invalid variants JSON format'
          })
        }
      } else {
        variantsData = body.variants
      }

      if (!Array.isArray(variantsData)) {
        return res.status(HttpStatusCode.BadRequest).json({
          message: 'Variants must be an array'
        })
      }

      console.log('Parsed variants:', variantsData.length)
      console.log('Parsed variants data:', JSON.stringify(variantsData, null, 2))

      // Use only the transaction-scoped snapshot captured above.
      const existingVariantNames = existingVariants.map((v: FnBMenuItem) => v.name)
      const newVariantNames = variantsData.map((v: any) => v.name)
      const retainedVariantIds = new Set(variantsData.map((v: any) => v._id && String(v._id)).filter(Boolean))

      console.log('Existing variant names:', existingVariantNames)
      console.log('New variant names:', newVariantNames)

      // Xóa các variants không còn trong danh sách mới
      for (const existingVariant of existingVariants) {
        if (!retainedVariantIds.has(existingVariant._id!.toString()) && !newVariantNames.includes(existingVariant.name)) {
          console.log(`Deleting variant: ${existingVariant.name}`)
          await fnBMenuItemService.deleteMenuItem(existingVariant._id!.toString(), session)
        }
      }

      for (let i = 0; i < variantsData.length; i++) {
        const variant = variantsData[i]

        // Tìm variant hiện tại theo tên và parentId
        let existingVariant = null
        if (variant._id) {
          existingVariant = existingVariants.find((candidate) => candidate._id?.toString() === String(variant._id)) ?? null
          console.log(`Found variant by _id: ${variant._id}`, existingVariant ? 'YES' : 'NO')
        } else {
          // Tìm theo tên nếu không có _id
          existingVariant = existingVariants.find((candidate) => candidate.name === variant.name) ?? null
          console.log(`Found variant by name: ${variant.name}`, existingVariant ? 'YES' : 'NO')
        }

        let variantImageUrl = variant.image || ''

        // Tìm ảnh mới cho variant (variantFile_0, variantFile_1, ...)
        const variantFile = files?.find((file) => file.fieldname === `variantFile_${i}`)
        if (variantFile) {
          const uploadResult = (await uploadImageToCloudinary(variantFile.buffer, 'menu-items/variants')) as {
            url: string
            publicId: string
          }
          variantImageUrl = uploadResult.url
        }

        console.log(`Processing variant: ${variant.name}`)
        console.log(`Variant inventory data:`, variant.inventory)

        const variantData: Partial<FnBMenuItem> = {
          name: variant.name,
          parentId: id,
          hasVariant: false,
          price: Number(variant.price),
          image: variantImageUrl || undefined,
          category: (variant.category as FnBCategory) || (body.category as FnBCategory) || FnBCategory.SNACK,
          inventory: {
            quantity: Number(variant.inventory?.quantity || variant.inventory || 0),
            minStock: variant.inventory?.minStock ? Number(variant.inventory.minStock) : undefined,
            maxStock: variant.inventory?.maxStock ? Number(variant.inventory.maxStock) : undefined,
            lastUpdated: new Date()
          },
          updatedAt: new Date()
        }
        if (
          Object.prototype.hasOwnProperty.call(variant, 'revenueCategory') ||
          Object.prototype.hasOwnProperty.call(body, 'revenueCategory')
        ) {
          variantData.revenueCategory = parseRevenueCategory(
            Object.prototype.hasOwnProperty.call(variant, 'revenueCategory')
              ? variant.revenueCategory
              : body.revenueCategory
          )
        }
        if (
          Object.prototype.hasOwnProperty.call(variant, 'inventoryTracked') ||
          Object.prototype.hasOwnProperty.call(body, 'inventoryTracked')
        ) {
          variantData.inventoryTracked = parseInventoryTracked(
            Object.prototype.hasOwnProperty.call(variant, 'inventoryTracked')
              ? variant.inventoryTracked
              : body.inventoryTracked
          )
        }
        if (variant.isActive !== undefined) {
          const parsedIsActive = parseIsActive(variant.isActive)
          if (parsedIsActive !== undefined) variantData.isActive = parsedIsActive
        }
        applyCustomizationConfig(variantData, variant as Record<string, unknown>)

        console.log(`Variant data to update:`, JSON.stringify(variantData, null, 2))

        let variantResult
        if (existingVariant) {
          console.log(`Updating existing variant: ${existingVariant._id}`)
          const variantClassificationContext = Object.prototype.hasOwnProperty.call(variant, 'revenueCategory')
            ? {
              actorId: req.decoded_authorization?.user_id ?? '',
              actorRole: UserRole.Admin,
              reason: typeof body.reason === 'string' ? body.reason.trim() : ''
              }
            : classificationContext
          // Cập nhật variant hiện tại
          variantResult = await fnBMenuItemService.updateMenuItem(
            existingVariant._id!.toString(),
            variantData,
            variantClassificationContext,
            session
          )
        } else {
          console.log(`Creating new variant`)
          // Tạo variant mới
          variantData.createdAt = new Date()
          variantResult = await fnBMenuItemService.createMenuItem(variantData as FnBMenuItem, session)
        }

        if (variantResult) {
          console.log(`Variant result:`, JSON.stringify(variantResult, null, 2))
          variants.push(variantResult)
        } else {
          console.log(`Failed to update/create variant: ${variant.name}`)
        }
      }

      // Lấy lại tất cả variants sau khi cập nhật
      const updatedVariants = await fnBMenuItemService.getVariantsByParentId(id, session)

      return { ...result, variants: updatedVariants }
    }

    // Nếu không có variants, trả về kết quả bình thường
    return result
    }
    const result = parsedVariants ? await databaseService.withTransaction(persist) : await persist()
    if (!result) return res.status(HttpStatusCode.NotFound).json({ message: 'Không tìm thấy menu item để cập nhật' })
    return res.status(HttpStatusCode.Ok).json({ message: 'Cập nhật thành công', result })
  } catch (error) {
    console.error('Error in updateMenuItem:', error)
    next(error)
  }
}

// Xóa menu item
export const deleteMenuItem = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const result = await fnBMenuItemService.deleteMenuItem(id)
    if (!result) return res.status(HttpStatusCode.NotFound).json({ message: 'Không tìm thấy menu item để xóa' })
    return res.status(HttpStatusCode.Ok).json({
      message: 'Xóa thành công',
      result: {
        deletedItem: result.item,
        deletedVariantIds: result.deletedVariantIds,
        deletedVariantCount: result.deletedVariantIds.length
      }
    })
  } catch (error) {
    next(error)
  }
}

// Dọn dữ liệu menu item (xóa orphan, chuẩn hóa parentId, bỏ field thừa)
export const cleanupMenuItems = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dryRun = req.body?.dryRun !== false && req.query.dryRun !== 'false'
    const result = await fnBMenuItemService.cleanupMenuItems(dryRun)

    return res.status(HttpStatusCode.Ok).json({
      message: dryRun
        ? 'Xem trước dọn dữ liệu menu thành công (chưa áp dụng). Gửi dryRun=false để thực thi.'
        : 'Dọn dữ liệu menu thành công',
      result
    })
  } catch (error) {
    next(error)
  }
}

// Cập nhật inventory của variant
export const updateVariantInventory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const { minStock, maxStock } = req.body

    // Lấy dữ liệu hiện tại để giữ nguyên quantity
    const currentItem = await fnBMenuItemService.getMenuItemById(id)
    if (!currentItem) {
      return res.status(HttpStatusCode.NotFound).json({ message: 'Không tìm thấy menu item' })
    }

    const updateData: Partial<FnBMenuItem> = {
      inventory: {
        quantity: currentItem.inventory?.quantity || 0,
        minStock: minStock ? Number(minStock) : undefined,
        maxStock: maxStock ? Number(maxStock) : undefined,
        lastUpdated: new Date()
      },
      updatedAt: new Date()
    }

    const result = await fnBMenuItemService.updateMenuItem(id, updateData)
    if (!result) return res.status(HttpStatusCode.NotFound).json({ message: 'Không tìm thấy menu item để cập nhật' })

    return res.status(HttpStatusCode.Ok).json({
      message: 'Cập nhật inventory thành công',
      result
    })
  } catch (error) {
    next(error)
  }
}
