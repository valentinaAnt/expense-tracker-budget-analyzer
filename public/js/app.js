import { api, ApiError } from './api.js';

// ---------- Formatting and date helpers ----------

const money = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });
const wholeMoney = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const monthFormat = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const shortMonthFormat = new Intl.DateTimeFormat('en-GB', { month: 'short' });

const AMOUNT_PATTERN = /^\d{1,7}(\.\d{1,2})?$/;
const MAX_AMOUNT = 1_000_000;
const MAX_DESCRIPTION_LENGTH = 200;
const MAX_CATEGORY_NAME_LENGTH = 40;
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

function formatMonth(month, format = monthFormat) {
  const [year, monthNumber] = month.split('-').map(Number);
  return format.format(new Date(year, monthNumber - 1, 1));
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

/** Same tidying as the server: trim and collapse inner spaces. */
const normalizeName = (text) => text.trim().replace(/\s+/g, ' ');

function categoryNameError(name) {
  if (name === '') return 'Enter a category name.';
  if (name.length > MAX_CATEGORY_NAME_LENGTH) return `Use at most ${MAX_CATEGORY_NAME_LENGTH} characters.`;
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
  resetExpense: $('reset-expense'),
  expenseTable: $('expense-table'),
  expenseRows: $('expense-rows'),
  expenseEmpty: $('expense-empty'),
  expenseLoading: $('expense-loading'),
  filterCategory: $('filter-category'),
  exportCsv: $('export-csv'),
  chart: $('category-chart'),
  chartEmpty: $('chart-empty'),
  topList: $('top-categories'),
  topEmpty: $('top-empty'),
  trendChart: $('trend-chart'),
  trendLabels: $('trend-labels'),
  trendBudget: $('trend-budget'),
  trendSubtitle: $('trend-subtitle'),
  budgetList: $('budget-list'),
  categoryForm: $('category-form'),
  newCategory: $('new-category'),
  newCategoryError: $('new-category-error'),
  categoryList: $('category-list'),
  dialog: $('confirm-dialog'),
  confirmTitle: $('confirm-title'),
  confirmMessage: $('confirm-message'),
  confirmExtra: $('confirm-extra'),
  confirmButton: $('confirm-button'),
};

const field = (name) => elements.form.elements.namedItem(name);

const state = {
  month: toMonth(new Date()),
  categories: [],
  budgets: [],
  expenses: [],
  filterCategoryId: '', // '' = all categories
  editingId: null,
  renamingId: null,
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

/** Shows or clears an error under a single input; aria-invalid must be "true", not just present. */
function setInputError(input, errorBox, message) {
  errorBox.textContent = message;
  if (message) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

/** Removes a field's error as soon as the user starts correcting it, so old messages never linger. */
function clearErrorWhileEditing(event) {
  const input = event.target;
  if (input.getAttribute?.('aria-invalid') !== 'true') return;
  const errorBox = document.getElementById(input.getAttribute('aria-describedby'));
  if (errorBox) setInputError(input, errorBox, '');
}

function showLoadError(error) {
  elements.loadErrorMessage.textContent = `Could not load data: ${errorMessage(error)}`;
  elements.loadError.hidden = false;
  elements.expenseLoading.hidden = true;
}

/**
 * Shows a modal confirmation dialog and resolves to true if the user confirms.
 * `extra` is an optional element (e.g. a drop-down) shown between the message and the buttons.
 */
function confirmAction({ title, message, confirmLabel, extra }) {
  elements.confirmTitle.textContent = title;
  elements.confirmMessage.textContent = message;
  elements.confirmExtra.replaceChildren(...(extra ? [extra] : []));
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
    const [categories, expenses, summary, budgets, trend] = await Promise.all([
      api.getCategories(),
      api.listExpenses(state.month, state.filterCategoryId),
      api.getSummary(state.month),
      api.listBudgets(),
      api.getTrend(state.month),
    ]);
    // Ignore the result if a newer refresh started meanwhile (e.g. the month was changed quickly).
    if (refreshId !== state.refreshId) return;

    state.categories = categories;
    state.budgets = budgets;
    state.expenses = expenses;
    elements.loadError.hidden = true;
    renderCategoryOptions();
    renderCategories();
    renderSummary(summary);
    renderTrend(trend);
    renderExpenses(expenses);
    renderBudgets(budgets);
    elements.exportCsv.href = api.exportUrl(state.month, state.filterCategoryId);
  } catch (error) {
    if (refreshId === state.refreshId) showLoadError(error);
  } finally {
    if (refreshId === state.refreshId) {
      elements.main.setAttribute('aria-busy', 'false');
      elements.main.classList.remove('is-loading');
    }
  }
}

/** Rebuilds a category drop-down, keeping the current choice if that category still exists. */
function fillCategorySelect(select, emptyLabel, current = select.value) {
  select.replaceChildren(
    el('option', { value: '', text: emptyLabel }),
    ...state.categories.map((category) => el('option', { value: category.id, text: category.name })),
  );
  select.value = state.categories.some((category) => String(category.id) === current) ? current : '';
}

function renderCategoryOptions() {
  fillCategorySelect(field('categoryId'), 'Choose…');
  fillCategorySelect(elements.filterCategory, 'All categories', state.filterCategoryId);
  state.filterCategoryId = elements.filterCategory.value;
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
      el('span', { className: 'top-bar', 'aria-hidden': 'true' }, [
        el('span', { className: 'top-bar-fill', style: { width: `${category.sharePercent}%` } }),
      ]),
      el('span', { className: 'top-share', text: `${category.sharePercent}% of this month's spending` }),
    ])));
  elements.topEmpty.hidden = topCategories.length > 0;
}

/**
 * Column chart of the last six months. Bars are scaled to the largest month or the monthly budget,
 * whichever is higher; a dashed line marks the budget. Clicking a bar opens that month.
 */
function renderTrend({ months, monthlyBudget }) {
  const scale = Math.max(...months.map((item) => item.totalSpent), monthlyBudget ?? 0);
  const height = (amount) => (scale > 0 ? (amount / scale) * 100 : 0);

  const bars = months.map((item) => {
    const over = monthlyBudget !== null && item.totalSpent > monthlyBudget;
    const classes = ['trend-column', item.month === state.month && 'is-selected', over && 'is-over'];
    const label = `${formatMonth(item.month)}: ${formatMoney(item.totalSpent)}${over ? ', over budget' : ''}. Show this month.`;
    return el('li', {}, [
      el('button', { type: 'button', className: classes.filter(Boolean).join(' '), dataset: { month: item.month },
        'aria-label': label, title: label }, [
        el('span', { className: 'trend-area' }, [
          el('span', { className: 'trend-value', text: wholeMoney.format(item.totalSpent),
            style: { bottom: `calc(${height(item.totalSpent)}% + 0.2rem)` } }),
          el('span', { className: 'trend-bar', style: { height: `${height(item.totalSpent)}%` } }),
        ]),
      ]),
    ]);
  });

  elements.trendChart.replaceChildren(...bars);
  elements.trendBudget.replaceChildren(...(monthlyBudget === null ? [] : [
    el('span', { className: 'trend-budget-line', style: { bottom: `${height(monthlyBudget)}%` } }),
  ]));
  elements.trendLabels.replaceChildren(...months.map((item) =>
    el('span', { className: item.month === state.month ? 'is-selected' : undefined,
      text: formatMonth(item.month, shortMonthFormat) })));
  elements.trendSubtitle.textContent = monthlyBudget === null
    ? 'Total spending per month.'
    : `Total spending per month; the dashed line is your monthly budget (${formatMoney(monthlyBudget)}).`;
}

// ---------- Expense list ----------

function renderExpenses(expenses) {
  elements.expenseLoading.hidden = true;
  elements.expenseEmpty.hidden = expenses.length > 0;
  elements.expenseTable.hidden = expenses.length === 0;
  elements.expenseEmpty.textContent = state.filterCategoryId
    ? `No ${categoryName(Number(state.filterCategoryId))} expenses in ${formatMonth(state.month)}.`
    : 'No expenses recorded for this month yet.';

  elements.expenseRows.replaceChildren(...expenses.map((expense) =>
    el('tr', { role: 'row', className: expense.id === state.editingId ? 'is-editing' : undefined }, [
      el('td', { role: 'cell', className: 'nowrap' }, [
        el('time', { datetime: expense.date, text: formatDate(expense.date) }),
      ]),
      el('td', { role: 'cell', className: 'description', text: expense.description }),
      el('td', { role: 'cell', className: 'category' }, [el('span', { className: 'pill', text: expense.categoryName })]),
      el('td', { role: 'cell', className: 'num', text: formatMoney(expense.amount) }),
      el('td', { role: 'cell', className: 'actions' }, [
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
  elements.resetExpense.textContent = 'Clear';
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
  elements.resetExpense.textContent = 'Cancel';
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
        el('label', { for: inputId, className: 'budget-name', text: category.name }, [
          el('span', { className: 'visually-hidden', text: ' monthly budget in euros' }),
        ]),
        el('span', { className: 'input-affix' }, [
          el('span', { className: 'affix', text: '€', 'aria-hidden': 'true' }),
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
        ]),
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
  const hasBudget = state.budgets.some((budget) => budget.categoryId === categoryId);

  // Save on an empty row without a budget (e.g. clicked by mistake) has nothing to do; it is not an error.
  if (value === '' && !hasBudget) {
    setInputError(input, errorBox, '');
    return;
  }

  const message = value === '' ? 'Enter an amount, or use Remove to delete this budget.' : amountError(value);
  setInputError(input, errorBox, message);
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
      setInputError(input, errorBox, error.details[0]?.message ?? error.message);
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

// ---------- Categories ----------

const expenseCountText = (count) => (count === 0 ? 'No expenses' : `${count} ${count === 1 ? 'expense' : 'expenses'}`);

function renderCategories() {
  elements.categoryList.replaceChildren(...state.categories.map((category) => {
    if (state.renamingId === category.id) {
      const inputId = `category-name-${category.id}`;
      const errorId = `${inputId}-error`;
      return el('li', {}, [
        el('form', { className: 'category-row is-renaming', dataset: { categoryId: category.id }, novalidate: true }, [
          el('label', { for: inputId, className: 'visually-hidden', text: `New name for ${category.name}` }),
          el('input', {
            id: inputId,
            className: 'text-input',
            name: 'name',
            type: 'text',
            maxlength: String(MAX_CATEGORY_NAME_LENGTH),
            autocomplete: 'off',
            value: category.name,
            'aria-describedby': errorId,
          }),
          el('button', { type: 'submit', className: 'btn btn-small btn-primary', text: 'Save' }),
          el('button', { type: 'button', className: 'btn btn-small', text: 'Cancel', dataset: { action: 'cancel-rename' } }),
          el('p', { id: errorId, className: 'field-error' }),
        ]),
      ]);
    }

    return el('li', { className: 'category-row', dataset: { categoryId: category.id } }, [
      el('span', { className: 'category-name', text: category.name }),
      el('span', { className: 'category-count', text: expenseCountText(category.expenseCount) }),
      el('button', {
        type: 'button',
        className: 'btn btn-small',
        text: 'Rename',
        dataset: { action: 'rename' },
        'aria-label': `Rename category ${category.name}`,
      }),
      el('button', {
        type: 'button',
        className: 'btn btn-small btn-danger-outline',
        text: 'Delete',
        dataset: { action: 'delete' },
        'aria-label': `Delete category ${category.name}`,
      }),
    ]);
  }));
}

function startRename(id) {
  state.renamingId = id;
  renderCategories();
  const input = $(`category-name-${id}`);
  input.focus();
  input.select();
}

function cancelRename(id) {
  state.renamingId = null;
  renderCategories();
  elements.categoryList.querySelector(`[data-category-id="${id}"] [data-action="rename"]`)?.focus();
}

async function handleCategoryAdd(event) {
  event.preventDefault();
  const input = elements.newCategory;
  const name = normalizeName(input.value);
  const message = categoryNameError(name);
  setInputError(input, elements.newCategoryError, message);
  if (message) {
    input.focus();
    return;
  }

  try {
    await api.createCategory(name);
    input.value = '';
    showStatus(`Category "${name}" added.`);
    await refresh();
  } catch (error) {
    if (error instanceof ApiError && ['VALIDATION_ERROR', 'CONFLICT'].includes(error.code)) {
      setInputError(input, elements.newCategoryError, error.details[0]?.message ?? error.message);
      input.focus();
    } else {
      showStatus(errorMessage(error), 'error');
    }
  }
}

async function handleCategoryRename(event) {
  event.preventDefault();
  const form = event.target;
  const id = Number(form.dataset.categoryId);
  const input = form.elements.namedItem('name');
  const errorBox = form.querySelector('.field-error');
  const name = normalizeName(input.value);
  const message = categoryNameError(name);
  setInputError(input, errorBox, message);
  if (message) {
    input.focus();
    return;
  }

  const oldName = categoryName(id);
  try {
    await api.renameCategory(id, name);
    state.renamingId = null;
    showStatus(oldName === name ? 'Category saved.' : `"${oldName}" renamed to "${name}".`);
    await refresh();
  } catch (error) {
    if (error instanceof ApiError && ['VALIDATION_ERROR', 'CONFLICT'].includes(error.code)) {
      setInputError(input, errorBox, error.details[0]?.message ?? error.message);
      input.focus();
    } else if (error instanceof ApiError && error.status === 404) {
      state.renamingId = null;
      showStatus('This category no longer exists.', 'error');
      await refresh();
    } else {
      showStatus(errorMessage(error), 'error');
    }
  }
}

/** Drop-down in the delete dialog for choosing where a category's expenses go. */
function moveTargetField(category, targets) {
  const count = expenseCountText(category.expenseCount).toLowerCase();
  const other = targets.find((target) => target.name === 'Other') ?? targets[0];
  return el('div', { className: 'field dialog-field' }, [
    el('label', { for: 'move-to', text: `Move its ${count} to` }),
    el('select', { id: 'move-to' }, targets.map((target) =>
      el('option', { value: target.id, text: target.name, selected: target === other }))),
  ]);
}

async function deleteCategory(category) {
  const hasExpenses = category.expenseCount > 0;
  const targets = state.categories.filter((item) => item.id !== category.id);
  if (hasExpenses && targets.length === 0) {
    showStatus(`"${category.name}" has expenses and there is no other category to move them to.`, 'error');
    return;
  }

  const budgetNote = state.budgets.some((budget) => budget.categoryId === category.id)
    ? ' together with its monthly budget' : '';
  const confirmed = await confirmAction(hasExpenses
    ? {
      title: 'Delete category?',
      message: `"${category.name}" will be deleted${budgetNote}. Its expenses are kept and moved to the category you choose.`,
      confirmLabel: 'Move and delete',
      extra: moveTargetField(category, targets),
    }
    : {
      title: 'Delete category?',
      message: `"${category.name}" will be deleted${budgetNote}.`,
      confirmLabel: 'Delete category',
    });
  if (!confirmed) return;

  const moveTo = hasExpenses ? Number($('move-to').value) : undefined;
  try {
    await api.deleteCategory(category.id, moveTo);
    showStatus(hasExpenses
      ? `Category "${category.name}" deleted; its expenses were moved to ${categoryName(moveTo)}.`
      : `Category "${category.name}" deleted.`);
    if (state.filterCategoryId === String(category.id)) state.filterCategoryId = '';
  } catch (error) {
    if (error instanceof ApiError && error.code === 'CONFLICT') {
      showStatus(error.message, 'error');
    } else if (!(error instanceof ApiError && error.status === 404)) {
      showStatus(errorMessage(error), 'error');
      return;
    }
  }
  await refresh();
}

function handleCategoryClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const id = Number(button.closest('[data-category-id]').dataset.categoryId);
  const category = state.categories.find((item) => item.id === id);
  if (!category) return;

  if (button.dataset.action === 'rename') startRename(id);
  else if (button.dataset.action === 'cancel-rename') cancelRename(id);
  else if (button.dataset.action === 'delete') deleteCategory(category);
}

// ---------- Theme ----------

const THEME_KEY = 'theme';
const themeToggle = $('theme-toggle');

/** Shows the chosen theme and labels the switch with the theme it will change to. */
function applyTheme(theme) {
  if (theme === 'dark') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  themeToggle.setAttribute('aria-label', label);
  themeToggle.title = label;
}

function toggleTheme() {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage unavailable (e.g. a private window): the theme still changes, it is just not remembered.
  }
}

// ---------- Start-up ----------

function bindEvents() {
  document.addEventListener('input', clearErrorWhileEditing);
  elements.form.addEventListener('submit', handleExpenseSubmit);
  // "Clear" while adding, "Cancel" while editing: both empty the form and return to add mode.
  elements.resetExpense.addEventListener('click', () => {
    resetForm();
    field('amount').focus();
  });

  elements.expenseRows.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const expense = state.expenses.find((item) => item.id === Number(button.dataset.id));
    if (!expense) return;
    if (button.dataset.action === 'edit') startEdit(expense);
    else deleteExpense(expense);
  });

  elements.filterCategory.addEventListener('change', () => {
    state.filterCategoryId = elements.filterCategory.value;
    refresh();
  });

  elements.trendChart.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-month]');
    if (button && button.dataset.month !== state.month) setMonth(button.dataset.month);
  });

  elements.budgetList.addEventListener('submit', handleBudgetSubmit);
  elements.budgetList.addEventListener('click', handleBudgetRemove);

  elements.categoryForm.addEventListener('submit', handleCategoryAdd);
  elements.categoryList.addEventListener('submit', handleCategoryRename);
  elements.categoryList.addEventListener('click', handleCategoryClick);
  elements.categoryList.addEventListener('keydown', (event) => {
    const form = event.target.closest('form.is-renaming');
    if (event.key === 'Escape' && form) cancelRename(Number(form.dataset.categoryId));
  });

  elements.month.addEventListener('change', () => {
    if (MONTH_PATTERN.test(elements.month.value)) setMonth(elements.month.value);
  });
  $('prev-month').addEventListener('click', () => setMonth(shiftMonth(state.month, -1)));
  $('next-month').addEventListener('click', () => setMonth(shiftMonth(state.month, 1)));
  $('retry').addEventListener('click', refresh);
  themeToggle.addEventListener('click', toggleTheme);
}

applyTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
bindEvents();
showMonth(state.month);
field('date').value = todayIso();
refresh();
