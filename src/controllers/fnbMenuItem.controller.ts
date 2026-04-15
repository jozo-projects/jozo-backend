import { Request, Response, NextFunction } from 'express'
import fnBMenuItemService from '~/services/fnbMenuItem.service'
import { FnBMenuItem } from '~/models/schemas/FnBMenuItem.schema'
import { HttpStatusCode } from 'axios'
import { uploadImageToCloudinary } from '~/services/cloudinary.service'
import { FnBCategory } from '~/constants/enum'
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

    // Nếu có variants, tạo parent + variants
    if (body.variants && hasVariant) {
      // Tạo sản phẩm cha trước
      let parentImageUrl = ''
      if (files && files.length > 0) {
        const uploadResult = (await uploadImageToCloudinary(files[0].buffer, 'menu-items')) as {
          url: string
          publicId: string
        }
        parentImageUrl = uploadResult.url
      }

      const parentItem: FnBMenuItem = {
        name: body.name,
        parentId: null,
        hasVariant: true,
        price: 0, // Sản phẩm cha không có giá
        image: parentImageUrl || undefined,
        category: (body.category as FnBCategory) || FnBCategory.SNACK,
        inventory: {
          quantity: 0, // Sản phẩm cha không có số lượng
          lastUpdated: new Date()
        },
        createdAt: new Date(),
        updatedAt: new Date()
      }
      applyCustomizationConfig(parentItem, body as Record<string, unknown>)

      const parentResult = await fnBMenuItemService.createMenuItem(parentItem)

      // Tạo các variants
      const variants = []
      const variantsData = typeof body.variants === 'string' ? JSON.parse(body.variants) : body.variants

      for (let i = 0; i < variantsData.length; i++) {
        const variant = variantsData[i]

        let variantImageUrl = ''

        // Tìm ảnh cho variant (variantFile_0, variantFile_1, ...)
        const variantFile = files?.find((file) => file.fieldname === `variantFile_${i}`)

        if (variantFile) {
          const uploadResult = (await uploadImageToCloudinary(variantFile.buffer, 'menu-items/variants')) as {
            url: string
            publicId: string
          }
          variantImageUrl = uploadResult.url
        } else {
          console.log(`No variant file found for variantFile_${i}`)
        }

        const variantItem: FnBMenuItem = {
          name: variant.name,
          parentId: parentResult._id?.toString() || '',
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
          createdAt: new Date(),
          updatedAt: new Date()
        }
        applyCustomizationConfig(variantItem, variant as Record<string, unknown>)

        const variantResult = await fnBMenuItemService.createMenuItem(variantItem)
        variants.push(variantResult)
      }

      return res.status(HttpStatusCode.Created).json({
        message: 'Tạo menu item với variants thành công',
        result: {
          parent: parentResult,
          variants: variants
        }
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
      inventory: {
        quantity: Number(body.quantity),
        minStock: body.minStock ? Number(body.minStock) : undefined,
        maxStock: body.maxStock ? Number(body.maxStock) : undefined,
        lastUpdated: new Date()
      },
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

// Tạo mới menu item với variants
export const createMenuItemWithVariants = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body
    const files = req.files as Express.Multer.File[]

    // Tạo sản phẩm cha trước
    let parentImageUrl = ''
    if (files && files.length > 0) {
      const uploadResult = (await uploadImageToCloudinary(files[0].buffer, 'menu-items')) as {
        url: string
        publicId: string
      }
      parentImageUrl = uploadResult.url
    }

    const parentItem: FnBMenuItem = {
      name: body.name,
      parentId: null,
      hasVariant: true,
      price: 0, // Sản phẩm cha không có giá
      image: parentImageUrl || undefined,
      category: (body.category as FnBCategory) || FnBCategory.SNACK,
      inventory: {
        quantity: 0, // Sản phẩm cha không có số lượng
        lastUpdated: new Date()
      },
      createdAt: new Date(),
      updatedAt: new Date()
    }
    applyCustomizationConfig(parentItem, body as Record<string, unknown>)

    const parentResult = await fnBMenuItemService.createMenuItem(parentItem)

    // Tạo các variants
    const variants = []
    if (body.variants) {
      const variantsData = typeof body.variants === 'string' ? JSON.parse(body.variants) : body.variants

      for (let i = 0; i < variantsData.length; i++) {
        const variant = variantsData[i]
        let variantImageUrl = ''

        // Tìm ảnh cho variant (variantFile_0, variantFile_1, ...)
        const variantFile = files?.find((file) => file.fieldname === `variantFile_${i}`)
        if (variantFile) {
          const uploadResult = (await uploadImageToCloudinary(variantFile.buffer, 'menu-items/variants')) as {
            url: string
            publicId: string
          }
          variantImageUrl = uploadResult.url
        }

        const variantItem: FnBMenuItem = {
          name: variant.name,
          parentId: parentResult._id?.toString() || '',
          hasVariant: false,
          price: Number(variant.price),
          image: variantImageUrl || undefined,
          category: (variant.category as FnBCategory) || (body.category as FnBCategory) || FnBCategory.SNACK,
          inventory: {
            quantity: Number(variant.inventory?.quantity || 0),
            minStock: variant.inventory?.minStock ? Number(variant.inventory.minStock) : undefined,
            maxStock: variant.inventory?.maxStock ? Number(variant.inventory.maxStock) : undefined,
            lastUpdated: new Date()
          },
          createdAt: new Date(),
          updatedAt: new Date()
        }
        applyCustomizationConfig(variantItem, variant as Record<string, unknown>)

        const variantResult = await fnBMenuItemService.createMenuItem(variantItem)
        variants.push(variantResult)
      }
    }

    return res.status(HttpStatusCode.Created).json({
      message: 'Tạo menu item với variants thành công',
      result: {
        parent: parentResult,
        variants: variants
      }
    })
  } catch (error) {
    next(error)
  }
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

// Lấy tất cả menu item
export const getAllMenuItems = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { category } = req.query

    let result
    if (category && Object.values(FnBCategory).includes(category as FnBCategory)) {
      result = await fnBMenuItemService.getMenuItemsByCategory(category as FnBCategory)
    } else {
      result = await fnBMenuItemService.getAllMenuItems()
    }

    // Parse variants nếu chúng là JSON string
    const parsedResult = result.map((item) => {
      if (item.hasVariant) {
        // Lấy variants cho từng parent item
        return fnBMenuItemService.getVariantsByParentId(item._id!.toString()).then((variants) => ({
          ...item,
          variants: variants
        }))
      }
      return {
        ...item,
        variants: []
      }
    })

    // Chờ tất cả promises resolve
    const finalResult = await Promise.all(parsedResult)

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

    // Chuẩn hóa hasVariant nếu có
    let updateData: Partial<FnBMenuItem> = { ...body }
    if (body.hasVariant !== undefined) {
      updateData.hasVariant = body.hasVariant === 'true' || body.hasVariant === true
    }
    if (body.price !== undefined) updateData.price = Number(body.price)
    if (body.quantity !== undefined) {
      updateData.inventory = {
        ...(updateData.inventory || {}),
        quantity: Number(body.quantity),
        lastUpdated: new Date()
      }
    }

    delete (updateData as Record<string, unknown>).customizationGroups
    delete (updateData as Record<string, unknown>).customizationTemplateRefs
    delete (updateData as Record<string, unknown>).customizationOverrides
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

    // Cập nhật sản phẩm cha
    const result = await fnBMenuItemService.updateMenuItem(id, updateData)
    if (!result) return res.status(HttpStatusCode.NotFound).json({ message: 'Không tìm thấy menu item để cập nhật' })

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

      // Lấy danh sách variants hiện tại để so sánh
      const existingVariants = await fnBMenuItemService.getVariantsByParentId(id)
      const existingVariantNames = existingVariants.map((v: FnBMenuItem) => v.name)
      const newVariantNames = variantsData.map((v: any) => v.name)

      console.log('Existing variant names:', existingVariantNames)
      console.log('New variant names:', newVariantNames)

      // Xóa các variants không còn trong danh sách mới
      for (const existingVariant of existingVariants) {
        if (!newVariantNames.includes(existingVariant.name)) {
          console.log(`Deleting variant: ${existingVariant.name}`)
          await fnBMenuItemService.deleteMenuItem(existingVariant._id!.toString())
        }
      }

      for (let i = 0; i < variantsData.length; i++) {
        const variant = variantsData[i]

        // Tìm variant hiện tại theo tên và parentId
        let existingVariant = null
        if (variant._id) {
          existingVariant = await fnBMenuItemService.getMenuItemById(variant._id)
          console.log(`Found variant by _id: ${variant._id}`, existingVariant ? 'YES' : 'NO')
        } else {
          // Tìm theo tên nếu không có _id
          existingVariant = await fnBMenuItemService.getVariantByNameAndParentId(variant.name, id)
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
        applyCustomizationConfig(variantData, variant as Record<string, unknown>)

        console.log(`Variant data to update:`, JSON.stringify(variantData, null, 2))

        let variantResult
        if (existingVariant) {
          console.log(`Updating existing variant: ${existingVariant._id}`)
          // Cập nhật variant hiện tại
          variantResult = await fnBMenuItemService.updateMenuItem(existingVariant._id!.toString(), variantData)
        } else {
          console.log(`Creating new variant`)
          // Tạo variant mới
          variantData.createdAt = new Date()
          variantResult = await fnBMenuItemService.createMenuItem(variantData as FnBMenuItem)
        }

        if (variantResult) {
          console.log(`Variant result:`, JSON.stringify(variantResult, null, 2))
          variants.push(variantResult)
        } else {
          console.log(`Failed to update/create variant: ${variant.name}`)
        }
      }

      // Lấy lại tất cả variants sau khi cập nhật
      const updatedVariants = await fnBMenuItemService.getVariantsByParentId(id)

      return res.status(HttpStatusCode.Ok).json({
        message: 'Cập nhật thành công',
        result: {
          ...result,
          variants: updatedVariants
        }
      })
    }

    // Nếu không có variants, trả về kết quả bình thường
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
    return res.status(HttpStatusCode.Ok).json({ message: 'Xóa thành công', result })
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
