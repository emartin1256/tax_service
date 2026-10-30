export const apiErrorResponseSchema = {
  type: 'object',
  properties: {
    statusCode: { type: 'number', example: 400 },
    error: { type: 'string', example: 'Bad Request' },
    message: { type: 'string' },
    requestId: { type: 'string', example: 'unknown' },
  },
  required: ['statusCode', 'error', 'message', 'requestId'],
};
