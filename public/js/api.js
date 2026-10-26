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

/** Builds a query string from the parameters that have a value, e.g. { month: '2026-10' } → "?month=2026-10". */
function query(params) {
  const search = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== ''));
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const api = {
  getCategories: () => request('GET', '/categories'),
  createCategory: (name) => request('POST', '/categories', { name }),
  renameCategory: (id, name) => request('PUT', `/categories/${id}`, { name }),
  /** With moveTo, the category's expenses are moved to that category before it is deleted. */
  deleteCategory: (id, moveTo) => request('DELETE', `/categories/${id}${query({ moveTo })}`),
  listExpenses: (month, categoryId) => request('GET', `/expenses${query({ month, categoryId })}`),
  /** A link (not a request): the browser downloads the CSV file itself. */
  exportUrl: (month, categoryId) => `/api/expenses/export${query({ month, categoryId })}`,
  createExpense: (expense) => request('POST', '/expenses', expense),
  updateExpense: (id, expense) => request('PUT', `/expenses/${id}`, expense),
  deleteExpense: (id) => request('DELETE', `/expenses/${id}`),
  listBudgets: () => request('GET', '/budgets'),
  setBudget: (categoryId, monthlyLimit) => request('PUT', `/budgets/${categoryId}`, { monthlyLimit }),
  deleteBudget: (categoryId) => request('DELETE', `/budgets/${categoryId}`),
  getSummary: (month) => request('GET', `/analytics/summary${query({ month })}`),
  getTrend: (month) => request('GET', `/analytics/trend${query({ month })}`),
};
