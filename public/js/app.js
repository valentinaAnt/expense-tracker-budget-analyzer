import { api, ApiError } from './api.js';

// ---------- Formatting and date helpers ----------

const money = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });
const dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const monthFormat = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });

const AMOUNT_PATTERN = /^\d{1,7}(\.\d{1,2})?$/;
const MAX_AMOUNT = 1_000_000;
const MAX_DESCRIPTION_LENGTH = 200;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const EXPENSE_FIELDS = ['amount', 'categoryId', 'date', 'description'];

const pad = (number) => String(number).padStart(2, '0');
const toMonth = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
const todayIso = () => `${toMonth(new Date())}-${pad(new Date().getDate())}`;
const formatMoney = (amount) => money.format(amount);
const toCents = (amount) => Math.round(amount * 100);

function shiftMonth(month, delta) {
  const [year, monthNumber] = month.split('-').map(Number);
  return toMonth(new Date(year, monthNumber - 1 + delta, 1));
}

function formatMonth(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  return monthFormat.format(new Date(year, monthNumber - 1, 1));
}

function formatDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return dayFormat.format(new Date(year, month - 1, day));
}

/** Returns an error message for an amount typed by the user, or '' if it is valid. */
function amountError(text) {
  if (text === '') return 'Enter an amount.';
  const amount = Number(text);
  if (!AMOUNT_PATTERN.test(text) || amount <= 0 || amount > MAX_AMOUNT) {
    return 'Enter a positive amount up to €1,000,000 with at most 2 decimals.';
  }
  return '';
}

// ---------- DOM helpers ----------

const $ = (id) => document.getElementById(id);

/**
 * Creates an element. Text is always set with textContent (never innerHTML),
 * so descriptions typed by the user can never be interpreted as HTML.
 */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'text') node.textContent = value;
    else if (key === 'className') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style') Object.assign(node.style, value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children);
  return node;
}

const elements = {
  main: $('main'),
  month: $('month'),
  status: $('status'),
  loadError: $('load-error'),
  loadErrorMessage: $('load-error-message'),
  form: $('expense-form'),
  formPanel: $('expense-form-panel'),
  formHeading: $('form-heading'),
  submit: $('submit-expense'),
  cancelEdit: $('cancel-edit'),
  expenseTable: $('expense-table'),
  expenseRows: $('expense-rows'),
  expenseEmpty: $('expense-empty'),
  expenseLoading: $('expense-loading'),
  chart: $('category-chart'),
  chartEmpty: $('chart-empty'),
  topList: $('top-categories'),
  topEmpty: $('top-empty'),
  budgetList: $('budget-list'),
  dialog: $('confirm-dialog'),
  confirmTitle: $('confirm-title'),
  confirmMessage: $('confirm-message'),
  confirmButton: $('confirm-button'),
};

const field = (name) => elements.form.elements.namedItem(name);

const state = {
  month: toMonth(new Date()),
  categories: [],
  expenses: [],
  editingId: null,
  refreshId: 0,
};

// ---------- Messages ----------

let statusTimer;

function showStatus(message, type = 'success') {
  elements.status.textContent = message;
  elements.status.className = `status status-${type} is-visible`;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => elements.status.classList.remove('is-visible'), type === 'error' ? 7000 : 3500);
}

function errorMessage(error) {
  if (error instanceof ApiError) return error.message;
  console.error(error);
  return 'Something went wrong. Please try again.';
}

function showLoadError(error) {
  elements.loadErrorMessage.textContent = `Could not load data: ${errorMessage(error)}`;
  elements.loadError.hidden = false;
  elements.expenseLoading.hidden = true;
}

/** Shows a modal confirmation dialog and resolves to true if the user confirms. */
function confirmAction({ title, message, confirmLabel }) {
  elements.confirmTitle.textContent = title;
  elements.confirmMessage.textContent = message;
  elements.confirmButton.textContent = confirmLabel;
  elements.dialog.returnValue = '';
  return new Promise((resolve) => {
    elements.dialog.addEventListener('close', () => resolve(elements.dialog.returnValue === 'confirm'), { once: true });
    elements.dialog.showModal();
  });
}

// ---------- Loading data ----------

function showMonth(month) {
  state.month = month;
  elements.month.value = month;
  for (const label of document.querySelectorAll('.month-label')) {
    label.textContent = formatMonth(month);
  }
}

async function setMonth(month) {
  showMonth(month);
  await refresh();
}

/** Reloads everything that depends on the stored data for the selected month. */
async function refresh() {
  const refreshId = ++state.refreshId;
  elements.main.setAttribute('aria-busy', 'true');
  elements.main.classList.add('is-loading');

  try {
    const [expenses, summary, budgets] = await Promise.all([
      api.listExpenses(state.month),
      api.getSummary(state.month),
      api.listBudgets(),
    ]);
    // Ignore the result if a newer refresh started meanwhile (e.g. the month was changed quickly).
    if (refreshId !== state.refreshId) return;

    state.expenses = expenses;
    elements.loadError.hidden = true;
    renderSummary(summary);
    renderExpenses(expenses);
    renderBudgets(budgets);
  } catch (error) {
    if (refreshId === state.refreshId) showLoadError(error);
  } finally {
    if (refreshId === state.refreshId) {
      elements.main.setAttribute('aria-busy', 'false');
      elements.main.classList.remove('is-loading');
    }
  }
}

async function loadCategories() {
  state.categories = await api.getCategories();
  field('categoryId').append(
    ...state.categories.map((category) => el('option', { value: category.id, text: category.name })),
  );
}

async function loadAll() {
  try {
    if (state.categories.length === 0) await loadCategories();
  } catch (error) {
    showLoadError(error);
    return;
  }
  await refresh();
}

// ---------- Dashboard ----------

function renderSummary(summary) {
  const budgeted = summary.categories.filter((category) => category.budget !== null);
  const remainingCents = budgeted.reduce((sum, category) => sum + toCents(category.remaining), 0);
  const overCount = budgeted.filter((category) => category.status === 'over').length;

  $('card-spent').textContent = formatMoney(summary.totalSpent);
  $('card-spent-note').textContent = `${summary.expenseCount} ${summary.expenseCount === 1 ? 'expense' : 'expenses'}`;

  $('card-budget').textContent = budgeted.length > 0 ? formatMoney(summary.totalBudget) : '–';
  $('card-budget-note').textContent = budgeted.length > 0
    ? `${budgeted.length} of ${state.categories.length} categories`
    : 'No budgets set';

  const remainingBox = $('card-remaining-box');
  remainingBox.classList.toggle('is-negative', remainingCents < 0);
  if (budgeted.length === 0) {
    $('card-remaining-title').textContent = 'Budget left';
    $('card-remaining').textContent = '–';
    $('card-remaining-note').textContent = '';
  } else if (remainingCents < 0) {
    $('card-remaining-title').textContent = 'Budget exceeded';
    $('card-remaining').textContent = formatMoney(-remainingCents / 100);
    $('card-remaining-note').textContent = 'more than budgeted in total';
  } else {
    $('card-remaining-title').textContent = 'Budget left';
    $('card-remaining').textContent = formatMoney(remainingCents / 100);
    $('card-remaining-note').textContent = 'across budgeted categories';
  }

  $('card-over').textContent = String(overCount);
  $('card-over-note').textContent = overCount === 1 ? 'category' : 'categories';
  $('card-over').closest('.card').classList.toggle('is-negative', overCount > 0);

  renderChart(summary.categories);
  renderTopCategories(summary.topCategories);
}

function budgetDetail(category) {
  if (category.budget === null) return 'No budget set';
  if (category.status === 'over') {
    return `${formatMoney(-category.remaining)} over budget · ${category.percentUsed}% used`;
  }
  const note = category.status === 'warning' ? ' · close to the limit' : '';
  return `${formatMoney(category.remaining)} left · ${category.percentUsed}% used${note}`;
}

function renderChart(categories) {
  const maxSpent = Math.max(0, ...categories.map((category) => category.spent));

  elements.chart.replaceChildren(...categories.map((category) => {
    const hasBudget = category.budget !== null;
    // Budgeted categories show budget usage; others show spending relative to the largest category.
    const width = hasBudget
      ? Math.min(category.percentUsed, 100)
      : (maxSpent > 0 ? (category.spent / maxSpent) * 100 : 0);
    const amounts = hasBudget
      ? `${formatMoney(category.spent)} of ${formatMoney(category.budget)}`
      : formatMoney(category.spent);

    return el('li', { className: `bar-item status-${category.status}` }, [
      el('div', { className: 'bar-header' }, [
        el('span', { className: 'bar-name', text: category.name }),
        el('span', { className: 'bar-amount', text: amounts }),
      ]),
      el('div', { className: 'bar-track', 'aria-hidden': 'true' }, [
        el('div', { className: 'bar-fill', style: { width: `${width}%` } }),
      ]),
      el('p', { className: 'bar-detail', text: budgetDetail(category) }),
    ]);
  }));
  elements.chartEmpty.hidden = categories.length > 0;
}

function renderTopCategories(topCategories) {
  elements.topList.replaceChildren(...topCategories.map((category) =>
    el('li', { className: 'top-item' }, [
      el('span', { className: 'top-name', text: category.name }),
      el('span', { className: 'top-amount', text: formatMoney(category.spent) }),
      el('span', { className: 'top-share', text: `${category.sharePercent}% of this month's spending` }),
    ])));
  elements.topEmpty.hidden = topCategories.length > 0;
}

// ---------- Expense list ----------

function renderExpenses(expenses) {
  elements.expenseLoading.hidden = true;
  elements.expenseEmpty.hidden = expenses.length > 0;
  elements.expenseTable.hidden = expenses.length === 0;

  elements.expenseRows.replaceChildren(...expenses.map((expense) =>
    el('tr', { className: expense.id === state.editingId ? 'is-editing' : undefined }, [
      el('td', { className: 'nowrap' }, [el('time', { datetime: expense.date, text: formatDate(expense.date) })]),
      el('td', { className: 'description', text: expense.description }),
      el('td', { text: expense.categoryName }),
      el('td', { className: 'num', text: formatMoney(expense.amount) }),
      el('td', { className: 'actions' }, [
        el('button', {
          type: 'button',
          className: 'btn btn-small',
          text: 'Edit',
          dataset: { action: 'edit', id: expense.id },
          'aria-label': `Edit expense: ${expense.description}`,
        }),
        el('button', {
          type: 'button',
          className: 'btn btn-small btn-danger-outline',
          text: 'Delete',
          dataset: { action: 'delete', id: expense.id },
          'aria-label': `Delete expense: ${expense.description}`,
        }),
      ]),
    ])));
}

async function deleteExpense(expense) {
  const confirmed = await confirmAction({
    title: 'Delete expense?',
    message: `"${expense.description}" (${formatMoney(expense.amount)} on ${formatDate(expense.date)}) will be permanently deleted.`,
    confirmLabel: 'Delete expense',
  });
  if (!confirmed) return;

  try {
    await api.deleteExpense(expense.id);
    showStatus('Expense deleted.');
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) {
      showStatus(errorMessage(error), 'error');
      return;
    }
    showStatus('This expense had already been deleted.', 'error');
  }
  if (state.editingId === expense.id) resetForm();
  await refresh();
}

// ---------- Expense form ----------

function readForm() {
  return {
    amount: field('amount').value.trim(),
    categoryId: Number(field('categoryId').value),
    date: field('date').value,
    description: field('description').value.trim(),
  };
}

function validateExpense(data) {
  const errors = {};
  const amountMessage = amountError(data.amount);
  if (amountMessage) errors.amount = amountMessage;
  if (!data.categoryId) errors.categoryId = 'Choose a category.';
  if (!data.date) errors.date = 'Choose a valid date.';
  if (!data.description) errors.description = 'Enter a description.';
  else if (data.description.length > MAX_DESCRIPTION_LENGTH) {
    errors.description = `Use at most ${MAX_DESCRIPTION_LENGTH} characters.`;
  }
  return errors;
}

/** Shows (or clears) the message under each field and moves focus to the first invalid one. */
function setFieldErrors(errors) {
  for (const name of EXPENSE_FIELDS) {
    const message = errors[name] ?? '';
    $(`${name}-error`).textContent = message;
    if (message) field(name).setAttribute('aria-invalid', 'true');
    else field(name).removeAttribute('aria-invalid');
  }
  const firstInvalid = EXPENSE_FIELDS.find((name) => errors[name]);
  if (firstInvalid) field(firstInvalid).focus();
}

function resetForm() {
  state.editingId = null;
  elements.form.reset();
  field('date').value = todayIso();
  setFieldErrors({});
  elements.formHeading.textContent = 'Add expense';
  elements.submit.textContent = 'Add expense';
  elements.cancelEdit.hidden = true;
  document.querySelector('tr.is-editing')?.classList.remove('is-editing');
}

function startEdit(expense) {
  state.editingId = expense.id;
  field('amount').value = expense.amount.toFixed(2);
  field('categoryId').value = String(expense.categoryId);
  field('date').value = expense.date;
  field('description').value = expense.description;
  setFieldErrors({});

  elements.formHeading.textContent = 'Edit expense';
  elements.submit.textContent = 'Save changes';
  elements.cancelEdit.hidden = false;
  renderExpenses(state.expenses);

  elements.formPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  field('amount').focus({ preventScroll: true });
}

async function handleExpenseSubmit(event) {
  event.preventDefault();
  const data = readForm();
  const errors = validateExpense(data);
  setFieldErrors(errors);
  if (Object.keys(errors).length > 0) return;

  const editing = state.editingId !== null;
  elements.submit.disabled = true;
  try {
    if (editing) await api.updateExpense(state.editingId, data);
    else await api.createExpense(data);

    const savedMonth = data.date.slice(0, 7);
    resetForm();
    showStatus(editing ? 'Expense updated.' : `Expense added to ${formatMonth(savedMonth)}.`);
    // Show the month the expense belongs to, so the user can see the result.
    if (savedMonth !== state.month) await setMonth(savedMonth);
    else await refresh();
  } catch (error) {
    if (error instanceof ApiError && error.code === 'VALIDATION_ERROR') {
      const serverErrors = Object.fromEntries(
        error.details.filter((detail) => EXPENSE_FIELDS.includes(detail.field)).map((d) => [d.field, d.message]),
      );
      setFieldErrors(serverErrors);
      showStatus('Please correct the highlighted fields.', 'error');
    } else if (error instanceof ApiError && error.status === 404) {
      resetForm();
      showStatus('This expense no longer exists.', 'error');
      await refresh();
    } else {
      showStatus(errorMessage(error), 'error');
    }
  } finally {
    elements.submit.disabled = false;
  }
}

// ---------- Budgets ----------

function renderBudgets(budgets) {
  const limits = new Map(budgets.map((budget) => [budget.categoryId, budget.monthlyLimit]));

  elements.budgetList.replaceChildren(...state.categories.map((category) => {
    const limit = limits.get(category.id);
    const inputId = `budget-${category.id}`;
    const errorId = `${inputId}-error`;

    return el('li', {}, [
      el('form', { className: 'budget-row', dataset: { categoryId: category.id }, novalidate: true }, [
        el('label', { for: inputId, className: 'budget-name', text: category.name }),
        el('input', {
          id: inputId,
          name: 'monthlyLimit',
          type: 'number',
          inputmode: 'decimal',
          step: '0.01',
          min: '0.01',
          max: '1000000',
          placeholder: 'No budget',
          value: limit === undefined ? undefined : limit.toFixed(2),
          'aria-describedby': errorId,
        }),
        el('button', {
          type: 'submit',
          className: 'btn btn-small',
          text: 'Save',
          'aria-label': `Save ${category.name} budget`,
        }),
        el('button', {
          type: 'button',
          className: 'btn btn-small btn-danger-outline',
          text: 'Remove',
          hidden: limit === undefined,
          dataset: { action: 'remove' },
          'aria-label': `Remove ${category.name} budget`,
        }),
        el('p', { id: errorId, className: 'field-error' }),
      ]),
    ]);
  }));
}

const categoryName = (id) => state.categories.find((category) => category.id === id)?.name ?? 'this category';

async function handleBudgetSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const categoryId = Number(form.dataset.categoryId);
  const input = form.elements.namedItem('monthlyLimit');
  const errorBox = form.querySelector('.field-error');
  const value = input.value.trim();

  const message = amountError(value);
  errorBox.textContent = message;
  input.toggleAttribute('aria-invalid', Boolean(message));
  if (message) {
    input.focus();
    return;
  }

  try {
    await api.setBudget(categoryId, value);
    showStatus(`Budget for ${categoryName(categoryId)} saved.`);
    await refresh();
  } catch (error) {
    if (error instanceof ApiError && error.code === 'VALIDATION_ERROR') {
      errorBox.textContent = error.details[0]?.message ?? error.message;
      input.setAttribute('aria-invalid', 'true');
    } else {
      showStatus(errorMessage(error), 'error');
    }
  }
}

async function handleBudgetRemove(event) {
  const button = event.target.closest('button[data-action="remove"]');
  if (!button) return;
  const categoryId = Number(button.closest('form').dataset.categoryId);
  const name = categoryName(categoryId);

  const confirmed = await confirmAction({
    title: 'Remove budget?',
    message: `The monthly budget for ${name} will be removed. Your expenses are not affected.`,
    confirmLabel: 'Remove budget',
  });
  if (!confirmed) return;

  try {
    await api.deleteBudget(categoryId);
    showStatus(`Budget for ${name} removed.`);
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) {
      showStatus(errorMessage(error), 'error');
      return;
    }
  }
  await refresh();
}

// ---------- Start-up ----------

function bindEvents() {
  elements.form.addEventListener('submit', handleExpenseSubmit);
  elements.cancelEdit.addEventListener('click', resetForm);

  elements.expenseRows.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const expense = state.expenses.find((item) => item.id === Number(button.dataset.id));
    if (!expense) return;
    if (button.dataset.action === 'edit') startEdit(expense);
    else deleteExpense(expense);
  });

  elements.budgetList.addEventListener('submit', handleBudgetSubmit);
  elements.budgetList.addEventListener('click', handleBudgetRemove);

  elements.month.addEventListener('change', () => {
    if (MONTH_PATTERN.test(elements.month.value)) setMonth(elements.month.value);
  });
  $('prev-month').addEventListener('click', () => setMonth(shiftMonth(state.month, -1)));
  $('next-month').addEventListener('click', () => setMonth(shiftMonth(state.month, 1)));
  $('retry').addEventListener('click', loadAll);
}

bindEvents();
showMonth(state.month);
field('date').value = todayIso();
loadAll();
