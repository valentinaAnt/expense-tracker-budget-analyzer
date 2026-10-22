// All communication with the backend goes through this module.

export class ApiError extends Error {
  constructor(status, code, message, details = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request(method, path, body) {
  const options = { method, headers: { Accept: 'application/json' } };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`/api${path}`, options);
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Is it still running?');
  }

  if (response.status === 204) return null;

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = data?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'HTTP_ERROR',
      error?.message ?? `Request failed with status ${response.status}`,
      error?.details ?? [],
    );
  }
  return data;
}

const query = (month) => `?month=${encodeURIComponent(month)}`;

export const api = {
  getCategories: () => request('GET', '/categories'),
  listExpenses: (month) => request('GET', `/expenses${query(month)}`),
  createExpense: (expense) => request('POST', '/expenses', expense),
  updateExpense: (id, expense) => request('PUT', `/expenses/${id}`, expense),
  deleteExpense: (id) => request('DELETE', `/expenses/${id}`),
  listBudgets: () => request('GET', '/budgets'),
  setBudget: (categoryId, monthlyLimit) => request('PUT', `/budgets/${categoryId}`, { monthlyLimit }),
  deleteBudget: (categoryId) => request('DELETE', `/budgets/${categoryId}`),
  getSummary: (month) => request('GET', `/analytics/summary${query(month)}`),
};
