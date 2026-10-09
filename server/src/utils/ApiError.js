class ApiError extends Error {
    constructor(
        statusCode,
        message = "Something wents wrong",
        errors = [],
        stack = ""
    ) {
        super(message);
        this.success = false;
        this.statusCode = statusCode;
        this.message = message;
        this.data = null;
        this.errors = errors;
        if (stack) {
            this.stack = stack;
        } else {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}
export { ApiError };