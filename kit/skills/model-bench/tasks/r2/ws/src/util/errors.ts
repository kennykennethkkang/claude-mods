export class AppError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export class NotFound extends AppError {
  constructor(what: string) {
    super(404, 'not_found', `${what} not found`)
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(400, 'invalid', message)
  }
}

export class Conflict extends AppError {
  constructor(message: string) {
    super(409, 'conflict', message)
  }
}

export class OutOfStock extends AppError {
  sku: string
  constructor(sku: string) {
    super(409, 'out_of_stock', `not enough ${sku}`)
    this.sku = sku
  }
}
