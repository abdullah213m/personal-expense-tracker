const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
const colors = ["#06b6d4", "#10b981", "#f59e0b", "#8b5cf6", "#f43f5e", "#38bdf8", "#ec4899", "#6366f1"];

const EXPENSE_CATEGORIES = [
  "Food & drink",
  "Transport",
  "Shopping",
  "Bills",
  "Health",
  "Entertainment",
  "Home",
  "Travel",
  "Education",
  "Other",
];

const INCOME_CATEGORIES = [
  "Salary / Wage",
  "Freelance & Consulting",
  "Business",
  "Investments",
  "Rental Income",
  "Bonus",
  "Gifts",
  "Other",
];

const form = document.querySelector("#transaction-form");
const dialog = document.querySelector("#transaction-dialog");
let editingId = null;
let toastTimer;
let goalAlertDismissed = false;
let lastAlertHash = "";
let currentSummary = null;
let chartViewMode = "timeline"; // "timeline", "monthly", "bars"
let hoveredPointIndex = null;

function formatMoney(amount) {
  return money.format(Number(amount) || 0);
}

function formatShortMoney(amount) {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "−" : "";
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(1)}Cr`;
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(1)}L`;
  if (abs >= 1000) return `${sign}₹${(abs / 1000).toFixed(1)}k`;
  return `${sign}₹${Math.round(abs)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function formatDate(value) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatShortDate(value) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatOrdinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Something went wrong. Please try again.");
  }
  return response.status === 204 ? null : response.json();
}

async function refreshDashboard() {
  const filters = new URLSearchParams();
  const filterValues = {
    search: document.querySelector("#search-filter").value.trim(),
    type: document.querySelector("#type-filter").value,
    category: document.querySelector("#category-filter").value,
    from: document.querySelector("#from-filter").value,
    to: document.querySelector("#to-filter").value,
  };
  Object.entries(filterValues).forEach(([key, value]) => value && filters.set(key, value));

  try {
    const [transactions, summary] = await Promise.all([
      requestJson(`/api/transactions?${filters.toString()}`),
      requestJson("/api/summary"),
    ]);
    renderTransactions(transactions);
    renderSummary(summary);
  } catch (error) {
    showToast(error.message);
  }
}

function renderTransactions(transactions) {
  const body = document.querySelector("#transaction-rows");
  document.querySelector("#transaction-count").textContent = transactions.length;
  document.querySelector("#results-note").textContent = transactions.length ? `Showing ${transactions.length} transaction${transactions.length === 1 ? "" : "s"}` : "";
  if (!transactions.length) {
    body.innerHTML = '<tr><td colspan="5" class="table-empty">No transactions match. Try changing your filters.</td></tr>';
    return;
  }

  body.innerHTML = transactions.map((transaction) => `
    <tr>
      <td class="description-cell">${escapeHtml(transaction.description)}<small>${transaction.type === "income" ? "Income" : "Expense"}</small></td>
      <td><span class="category-tag"><i></i>${escapeHtml(transaction.category)}</span></td>
      <td>${formatDate(transaction.date)}</td>
      <td class="amount-cell ${transaction.type}">${transaction.type === "income" ? "+" : "−"}${formatMoney(transaction.amount)}</td>
      <td class="action-cell">
        <div class="row-actions">
          <button class="row-action edit-action" type="button" data-edit="${transaction.id}" aria-label="Edit ${escapeHtml(transaction.description)}" title="Edit transaction">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </button>
          <button class="row-action delete-action" type="button" data-delete="${transaction.id}" data-desc="${escapeHtml(transaction.description)}" aria-label="Delete ${escapeHtml(transaction.description)}" title="Delete transaction">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
          </button>
        </div>
      </td>
    </tr>`).join("");
}

function renderSummary(summary) {
  currentSummary = summary;
  document.querySelector("#balance-value").textContent = formatMoney(summary.balance);
  document.querySelector("#income-value").textContent = formatMoney(summary.income);
  document.querySelector("#expense-value").textContent = formatMoney(summary.expenses);
  document.querySelector("#balance-caption").textContent = summary.month;
  document.querySelector("#income-caption").textContent = summary.month;
  document.querySelector("#expense-caption").textContent = summary.month;
  document.querySelector("#category-period").textContent = summary.month.toUpperCase();

  const balanceTrendPill = document.querySelector("#balance-trend-pill");
  if (balanceTrendPill) {
    const isPositive = (summary.balance || 0) >= 0;
    balanceTrendPill.textContent = isPositive ? "▲ Surplus" : "▼ Deficit";
    balanceTrendPill.style.background = isPositive ? "rgba(16, 185, 129, 0.15)" : "rgba(244, 63, 94, 0.15)";
    balanceTrendPill.style.borderColor = isPositive ? "rgba(16, 185, 129, 0.3)" : "rgba(244, 63, 94, 0.3)";
    balanceTrendPill.style.color = isPositive ? "#34d399" : "#fb7185";
  }

  const netVal = document.querySelector("#chart-net-val");
  const netChip = document.querySelector("#chart-stat-chip");
  if (netVal && netChip) {
    const isPositive = (summary.balance || 0) >= 0;
    netVal.textContent = `${isPositive ? "+" : "−"}${formatMoney(Math.abs(summary.balance || 0))}`;
    netChip.className = `chart-stat-chip ${isPositive ? "positive" : "negative"}`;
  }

  renderCategories(summary.categories || []);
  renderChart();
  renderGoals(summary.goals || []);
  renderRecurringIncomes(summary.recurring_incomes || []);
  renderSavingsGoalAlert(summary);
}

function renderGoals(goals) {
  const container = document.querySelector("#goals-list");
  document.querySelector("#goal-count").textContent = goals.length;
  if (!goals.length) {
    container.innerHTML = '<p class="empty-copy">Create a goal to start tracking your progress.</p>';
    return;
  }
  container.innerHTML = goals.map((goal) => {
    const percentage = Math.min(100, (goal.saved / goal.target) * 100);
    const remaining = Math.max(0, goal.target - goal.saved);
    return `
      <article class="goal-card">
        <div class="goal-card-top">
          <span class="goal-symbol" aria-hidden="true">✦</span>
          <button class="row-action delete-action goal-delete" type="button" data-delete-goal="${goal.id}" data-name="${escapeHtml(goal.name)}" aria-label="Delete ${escapeHtml(goal.name)}" title="Delete goal">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
          </button>
        </div>
        <h3>${escapeHtml(goal.name)}</h3>
        <div class="goal-amounts"><strong>${formatMoney(goal.saved)}</strong><span>of ${formatMoney(goal.target)}</span></div>
        <div class="goal-progress-track" role="progressbar" aria-label="${escapeHtml(goal.name)} progress" aria-valuenow="${Math.round(percentage)}" aria-valuemin="0" aria-valuemax="100"><div class="goal-progress-fill" style="width:${percentage}%"></div></div>
        <div class="goal-card-bottom"><span>${Math.round(percentage)}% saved${goal.deadline ? ` · by ${formatDate(goal.deadline)}` : ""}</span><button class="goal-contribute" type="button" data-contribute-goal="${goal.id}" data-goal-name="${escapeHtml(goal.name)}">+ Add savings</button></div>
        ${remaining === 0 ? '<p class="goal-complete">✓ Goal reached</p>' : ""}
      </article>`;
  }).join("");
}

function renderRecurringIncomes(recurringIncomes) {
  const container = document.querySelector("#recurring-list");
  const countEl = document.querySelector("#recurring-count");
  if (!container) return;
  if (countEl) countEl.textContent = recurringIncomes.length;

  if (!recurringIncomes.length) {
    container.innerHTML = '<p class="empty-copy">No recurring salary setup yet. Configure your monthly salary to auto-credit every month.</p>';
    return;
  }

  const currentMonthStr = new Date().toISOString().slice(0, 7);

  container.innerHTML = recurringIncomes.map((item) => {
    const isCreditedThisMonth = item.last_processed_month === currentMonthStr;
    const dayLabel = `${formatOrdinal(item.day_of_month)} of month`;

    return `
      <article class="recurring-card">
        <div class="recurring-card-top">
          <span class="recurring-symbol" aria-hidden="true">💼</span>
          <span class="recurring-day-chip">Auto-credits on ${dayLabel}</span>
          <button class="row-action delete-action" type="button" data-delete-recurring="${item.id}" data-title="${escapeHtml(item.title)}" aria-label="Delete ${escapeHtml(item.title)}" title="Delete salary schedule">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
          </button>
        </div>
        <h3>${escapeHtml(item.title)}</h3>
        <div class="recurring-amount">
          <strong>+${formatMoney(item.amount)}</strong>
          <span class="recurring-category-badge">· ${escapeHtml(item.category)}</span>
        </div>
        <div class="recurring-card-bottom">
          <span class="recurring-status ${isCreditedThisMonth ? "credited" : ""}">
            ${isCreditedThisMonth ? "✓ Credited for this month" : `Scheduled for ${dayLabel}`}
          </span>
          ${!isCreditedThisMonth ? `<button class="recurring-credit-btn" type="button" data-credit-recurring="${item.id}">Credit Now ⚡</button>` : ""}
        </div>
      </article>
    `;
  }).join("");
}

function renderSavingsGoalAlert(summary) {
  const alertEl = document.querySelector("#goal-alert");
  const copyEl = document.querySelector("#goal-alert-copy");
  const titleEl = document.querySelector("#goal-alert-title");
  const iconEl = document.querySelector("#goal-alert-icon");
  const tagEl = document.querySelector("#goal-alert-tag");
  if (!alertEl) return;

  const goals = summary.goals || [];
  const income = Number(summary.income) || 0;
  const balance = Number(summary.balance) || 0;

  const activeGoals = goals.filter((g) => g.target - g.saved > 0);
  if (!activeGoals.length) {
    alertEl.hidden = true;
    return;
  }

  let alertType = null;
  let title = "";
  let tag = "";
  let icon = "";
  let copy = "";
  let alertHash = "";

  // 1. Deficit warning (balance < 0)
  if (balance < 0) {
    const primary = activeGoals[0];
    const deficit = Math.abs(balance);
    alertType = "danger";
    icon = "🚨";
    tag = "Deficit Alert";
    title = "Money is low for your savings goals!";
    copy = `You have spent ${formatMoney(deficit)} more than your income this month. With a negative balance of ${formatMoney(balance)}, no funds are available for your "${primary.name}" goal (${formatMoney(primary.target - primary.saved)} remaining). Trim non-essential expenses to stay on track.`;
    alertHash = `danger-${balance}-${primary.id}`;
  } else {
    // 2. Check if balance is tight / low relative to remaining goal targets
    let criticalGoal = null;
    let tightGoal = null;

    for (const goal of activeGoals) {
      const remaining = goal.target - goal.saved;
      if (balance < remaining) {
        criticalGoal = { goal, remaining };
        break;
      } else if (balance <= remaining * 1.3) {
        tightGoal = { goal, remaining };
        break;
      }
    }

    if (criticalGoal) {
      const { goal, remaining } = criticalGoal;
      alertType = "warning";
      icon = "⚠️";
      tag = "Low Savings Buffer";
      title = "Money is low for your savings goals!";
      copy = `Your current monthly balance of ${formatMoney(balance)} is lower than the ${formatMoney(remaining)} needed to reach your "${goal.name}" goal. Consider cutting back on discretionary spending to fund your savings!`;
      alertHash = `crit-${goal.id}-${Math.round(balance / 100)}`;
    } else if (tightGoal) {
      const { goal, remaining } = tightGoal;
      alertType = "warning";
      icon = "⚠️";
      tag = "Tight Margin";
      title = "Monthly balance is getting close to savings goal target";
      copy = `Your monthly balance of ${formatMoney(balance)} is getting very tight for your "${goal.name}" goal requirement (${formatMoney(remaining)} needed). Keep an eye on upcoming spending to maintain your savings cushion.`;
      alertHash = `tight-${goal.id}-${Math.round(balance / 100)}`;
    } else {
      // 3. Milestone: Income or savings approaching target
      const nearGoal = goals.find((goal) => income >= goal.target * 0.9 && income < goal.target);
      if (nearGoal) {
        alertType = "info";
        icon = "🎯";
        tag = "Milestone";
        title = "You're getting close to a savings goal!";
        copy = `${formatMoney(income)} income this month is within 10% of your “${nearGoal.name}” target of ${formatMoney(nearGoal.target)}.`;
        alertHash = `milestone-${nearGoal.id}`;
      }
    }
  }

  if (!alertType) {
    alertEl.hidden = true;
    return;
  }

  if (alertHash !== lastAlertHash) {
    goalAlertDismissed = false;
    lastAlertHash = alertHash;
  }

  if (goalAlertDismissed) {
    alertEl.hidden = true;
    return;
  }

  alertEl.className = `goal-alert ${alertType}`;
  if (iconEl) iconEl.textContent = icon;
  if (tagEl) tagEl.textContent = tag;
  if (titleEl) titleEl.textContent = title;
  if (copyEl) copyEl.textContent = copy;
  alertEl.hidden = false;
}

function renderCategories(categories) {
  const container = document.querySelector("#category-list");
  if (!categories.length) {
    container.innerHTML = '<p class="empty-copy">No expenses recorded this month yet.</p>';
    return;
  }
  const maxAmount = Math.max(...categories.map((item) => item.total));
  container.innerHTML = categories.map((item, index) => {
    const col = colors[index % colors.length];
    return `
      <div class="category-row">
        <span class="category-name"><i class="category-swatch" style="background:${col}"></i>${escapeHtml(item.category)}</span>
        <span class="category-amount">${formatMoney(item.total)}</span>
        <div class="category-track"><div class="category-fill" style="width:${Math.max(4, (item.total / maxAmount) * 100)}%;background:${col}"></div></div>
      </div>`;
  }).join("");
}

// Coordinate-Grid Up-and-Down Line Chart Renderer
function renderChart() {
  const canvas = document.querySelector("#cashflow-chart");
  const empty = document.querySelector("#chart-empty");
  if (!canvas || !currentSummary) return;

  const bounds = canvas.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  const width = bounds.width || 480;
  const height = bounds.height || 230;

  canvas.width = Math.max(1, Math.round(width * pixelRatio));
  canvas.height = Math.max(1, Math.round(height * pixelRatio));

  const ctx = canvas.getContext("2d");
  ctx.resetTransform();
  ctx.scale(pixelRatio, pixelRatio);
  ctx.clearRect(0, 0, width, height);

  let pointsData = [];

  if (chartViewMode === "timeline") {
    const timeline = currentSummary.timeline || [];
    if (timeline.length === 0) {
      if (empty) empty.classList.remove("hidden");
      return;
    }
    if (empty) empty.classList.add("hidden");

    if (timeline.length === 1) {
      pointsData.push({
        label: "Start",
        fullDate: "Initial Origin",
        value: 0,
        income: 0,
        expense: 0,
      });
    }

    timeline.forEach((t) => {
      pointsData.push({
        label: formatShortDate(t.date),
        fullDate: formatDate(t.date),
        value: t.balance,
        income: t.income,
        expense: t.expenses,
      });
    });
  } else if (chartViewMode === "monthly") {
    const months = currentSummary.months || [];
    if (months.length === 0) {
      if (empty) empty.classList.remove("hidden");
      return;
    }
    if (empty) empty.classList.add("hidden");

    months.forEach((m) => {
      const [year, monthNumber] = m.month.split("-").map(Number);
      const dateObj = new Date(year, monthNumber - 1);
      pointsData.push({
        label: dateObj.toLocaleDateString("en-US", { month: "short" }),
        fullDate: dateObj.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
        value: Number(m.income) - Number(m.expenses),
        income: Number(m.income),
        expense: Number(m.expenses),
      });
    });
  } else {
    renderBarsMode(ctx, width, height, currentSummary.months || [], empty);
    return;
  }

  if (empty) empty.classList.add("hidden");

  const padding = { top: 30, right: 36, bottom: 36, left: 56 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const values = pointsData.map((p) => p.value);
  let minVal = Math.min(0, ...values);
  let maxVal = Math.max(100, ...values);

  const range = maxVal - minVal || 1;
  maxVal += range * 0.15;
  if (minVal < 0) minVal -= range * 0.15;

  const getY = (val) => padding.top + chartHeight - ((val - minVal) / (maxVal - minVal)) * chartHeight;
  const getX = (idx) => padding.left + (pointsData.length <= 1 ? chartWidth / 2 : (idx / (pointsData.length - 1)) * chartWidth);

  // 1. Draw Coordinate Grid Matrix (Horizontal & Vertical)
  const hGridLines = 5;

  ctx.strokeStyle = "rgba(255, 255, 255, 0.07)";
  ctx.lineWidth = 1;

  for (let i = 0; i <= hGridLines; i++) {
    const val = minVal + (maxVal - minVal) * (i / hGridLines);
    const y = getY(val);

    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();

    ctx.font = '600 10px "Space Grotesk", "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = "#64748b";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(formatShortMoney(val), padding.left - 10, y);
  }

  for (let i = 0; i < pointsData.length; i++) {
    const x = getX(i);
    ctx.beginPath();
    ctx.moveTo(x, padding.top - 8);
    ctx.lineTo(x, height - padding.bottom);
    ctx.stroke();
  }

  const zeroY = getY(0);
  if (zeroY >= padding.top && zeroY <= height - padding.bottom) {
    ctx.beginPath();
    ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
    ctx.lineWidth = 1.5;
    ctx.moveTo(padding.left, zeroY);
    ctx.lineTo(width - padding.right, zeroY);
    ctx.stroke();
  }

  const coords = pointsData.map((p, idx) => ({
    x: getX(idx),
    y: getY(p.value),
    data: p,
  }));

  // 2. Area Gradient
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(coords[0].x, zeroY);
  ctx.lineTo(coords[0].x, coords[0].y);
  for (let i = 1; i < coords.length; i++) {
    ctx.lineTo(coords[i].x, coords[i].y);
  }
  ctx.lineTo(coords[coords.length - 1].x, zeroY);
  ctx.closePath();

  const areaGrad = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
  areaGrad.addColorStop(0, "rgba(6, 182, 212, 0.25)");
  areaGrad.addColorStop(0.6, "rgba(6, 182, 212, 0.05)");
  areaGrad.addColorStop(1, "rgba(244, 63, 94, 0.12)");
  ctx.fillStyle = areaGrad;
  ctx.fill();
  ctx.restore();

  // 3. Up & Down Line (Radiant Cyan/Teal)
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(coords[0].x, coords[0].y);
  for (let i = 1; i < coords.length; i++) {
    ctx.lineTo(coords[i].x, coords[i].y);
  }
  ctx.strokeStyle = "#06b6d4";
  ctx.lineWidth = 3.8;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(6, 182, 212, 0.5)";
  ctx.shadowBlur = 8;
  ctx.stroke();
  ctx.restore();

  // 4. Prominent Donut Nodes
  coords.forEach((c, idx) => {
    const isHovered = hoveredPointIndex === idx;

    if (isHovered) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, 11, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(6, 182, 212, 0.35)";
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(c.x, c.y, isHovered ? 7 : 5.5, 0, Math.PI * 2);
    ctx.fillStyle = "#06b6d4";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(c.x, c.y, isHovered ? 4 : 3, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();

    ctx.font = '600 10px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = isHovered ? "#38bdf8" : "#94a3b8";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(c.data.label, c.x, height - padding.bottom + 8);
  });

  // 5. Crosshair Guides
  if (hoveredPointIndex !== null && coords[hoveredPointIndex]) {
    const hc = coords[hoveredPointIndex];
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = "rgba(56, 189, 248, 0.6)";
    ctx.lineWidth = 1;

    ctx.moveTo(hc.x, padding.top - 8);
    ctx.lineTo(hc.x, height - padding.bottom);

    ctx.moveTo(padding.left, hc.y);
    ctx.lineTo(width - padding.right, hc.y);
    ctx.stroke();
    ctx.restore();
  }
}

function renderBarsMode(ctx, width, height, months, empty) {
  if (!months.length) {
    if (empty) empty.classList.remove("hidden");
    return;
  }
  if (empty) empty.classList.add("hidden");

  const padding = { top: 28, right: 28, bottom: 32, left: 52 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const maxValue = Math.max(100, ...months.flatMap((m) => [m.income, m.expenses])) * 1.15;
  const slotWidth = chartWidth / months.length;
  const barWidth = Math.min(22, slotWidth * 0.28);
  const gap = 4;

  ctx.strokeStyle = "rgba(255, 255, 255, 0.07)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + (chartHeight * i) / 4;
    const val = maxValue * (1 - i / 4);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();

    ctx.font = '600 10px "Space Grotesk", sans-serif';
    ctx.fillStyle = "#64748b";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(formatShortMoney(val), padding.left - 8, y);
  }

  months.forEach((m, idx) => {
    const cx = padding.left + slotWidth * (idx + 0.5);
    const incH = (m.income / maxValue) * chartHeight;
    const expH = (m.expenses / maxValue) * chartHeight;
    const base = padding.top + chartHeight;

    if (m.income > 0) {
      const grad = ctx.createLinearGradient(0, base - incH, 0, base);
      grad.addColorStop(0, "#38bdf8");
      grad.addColorStop(1, "#2563eb");
      ctx.fillStyle = grad;
      ctx.fillRect(cx - barWidth - gap / 2, base - incH, barWidth, incH);
    }

    if (m.expenses > 0) {
      const grad = ctx.createLinearGradient(0, base - expH, 0, base);
      grad.addColorStop(0, "#fb7185");
      grad.addColorStop(1, "#e11d48");
      ctx.fillStyle = grad;
      ctx.fillRect(cx + gap / 2, base - expH, barWidth, expH);
    }

    const [year, monthNumber] = m.month.split("-").map(Number);
    const dateObj = new Date(year, monthNumber - 1);
    ctx.font = '600 10px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = "#94a3b8";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(dateObj.toLocaleDateString("en-US", { month: "short" }), cx, base + 8);
  });
}

// Interactive Tooltip & Hover handling on Canvas
const chartCanvas = document.querySelector("#cashflow-chart");
const chartTooltip = document.querySelector("#chart-tooltip");

function handleChartHover(event) {
  if (!currentSummary || !chartCanvas) return;
  const rect = chartCanvas.getBoundingClientRect();
  const clientX = event.clientX || (event.touches && event.touches[0] ? event.touches[0].clientX : null);
  const clientY = event.clientY || (event.touches && event.touches[0] ? event.touches[0].clientY : null);
  if (clientX === null) return;

  const mouseX = clientX - rect.left;
  const mouseY = clientY - rect.top;

  const padding = { top: 30, right: 36, bottom: 36, left: 56 };
  const chartWidth = rect.width - padding.left - padding.right;

  let points = [];
  if (chartViewMode === "timeline") {
    const timeline = currentSummary.timeline || [];
    if (timeline.length === 1) {
      points.push({ label: "Start", fullDate: "Initial Baseline", value: 0, income: 0, expense: 0 });
    }
    timeline.forEach((t) => points.push({
      label: formatShortDate(t.date),
      fullDate: formatDate(t.date),
      value: t.balance,
      income: t.income,
      expense: t.expenses,
    }));
  } else if (chartViewMode === "monthly") {
    (currentSummary.months || []).forEach((m) => {
      const [year, monthNumber] = m.month.split("-").map(Number);
      const dateObj = new Date(year, monthNumber - 1);
      points.push({
        label: dateObj.toLocaleDateString("en-US", { month: "short" }),
        fullDate: dateObj.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
        value: Number(m.income) - Number(m.expenses),
        income: Number(m.income),
        expense: Number(m.expenses),
      });
    });
  }

  if (!points.length) return;

  let closestIdx = 0;
  let minDist = Infinity;

  points.forEach((_, idx) => {
    const x = padding.left + (points.length <= 1 ? chartWidth / 2 : (idx / (points.length - 1)) * chartWidth);
    const dist = Math.abs(mouseX - x);
    if (dist < minDist) {
      minDist = dist;
      closestIdx = idx;
    }
  });

  if (minDist < chartWidth / Math.max(1, points.length) + 30) {
    hoveredPointIndex = closestIdx;
    const p = points[closestIdx];
    const isUp = p.value >= 0;

    chartTooltip.innerHTML = `
      <div class="tip-title">
        <span>${escapeHtml(p.fullDate)}</span>
        <span class="tip-badge">${isUp ? "▲ Surplus" : "▼ Deficit"}</span>
      </div>
      <div class="tip-row">
        <span class="tip-label">Running Balance:</span>
        <span class="tip-val tip-net ${isUp ? "up" : "down"}">${isUp ? "+" : "−"}${formatMoney(Math.abs(p.value))}</span>
      </div>
      ${p.income > 0 ? `<div class="tip-row"><span class="tip-label">Income:</span><span class="tip-val tip-income">+${formatMoney(p.income)}</span></div>` : ""}
      ${p.expense > 0 ? `<div class="tip-row"><span class="tip-label">Expense:</span><span class="tip-val tip-expense">−${formatMoney(p.expense)}</span></div>` : ""}
    `;

    const hoverX = padding.left + (points.length <= 1 ? chartWidth / 2 : (closestIdx / (points.length - 1)) * chartWidth);
    chartTooltip.style.left = `${hoverX}px`;
    chartTooltip.style.top = `${Math.max(15, Math.min(mouseY, rect.height - 45))}px`;
    chartTooltip.hidden = false;

    renderChart();
  } else {
    hideChartTooltip();
  }
}

function hideChartTooltip() {
  if (hoveredPointIndex !== null) {
    hoveredPointIndex = null;
    if (chartTooltip) chartTooltip.hidden = true;
    renderChart();
  }
}

if (chartCanvas) {
  chartCanvas.addEventListener("mousemove", handleChartHover);
  chartCanvas.addEventListener("mouseleave", hideChartTooltip);
  chartCanvas.addEventListener("touchstart", handleChartHover, { passive: true });
  chartCanvas.addEventListener("touchmove", handleChartHover, { passive: true });
  chartCanvas.addEventListener("touchend", hideChartTooltip);
}

// Chart View Mode Switching
document.querySelectorAll(".chart-toggle-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".chart-toggle-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    chartViewMode = btn.dataset.chartMode || "timeline";
    
    const dynamicLegend = document.querySelector("#chart-dynamic-legend");
    if (dynamicLegend) {
      if (chartViewMode === "timeline") {
        dynamicLegend.innerHTML = `
          <span class="legend-item"><i class="legend-grid-line"></i> Balance Trajectory (Up/Down)</span>
          <span class="legend-item"><i class="legend-income"></i> Income Point</span>
          <span class="legend-item"><i class="legend-expense"></i> Expense Point</span>
        `;
      } else if (chartViewMode === "monthly") {
        dynamicLegend.innerHTML = `
          <span class="legend-item"><i class="legend-grid-line"></i> Monthly Net Trend</span>
          <span class="legend-item"><i class="legend-income"></i> Income</span>
          <span class="legend-item"><i class="legend-expense"></i> Spending</span>
        `;
      } else {
        dynamicLegend.innerHTML = `
          <span class="legend-item"><i class="legend-income"></i> Income Bar</span>
          <span class="legend-item"><i class="legend-expense"></i> Spending Bar</span>
        `;
      }
    }

    renderChart();
  });
});

// Category and Placeholder Switcher for Expense vs Income
function updateCategoryDropdown(selectedCategory = null) {
  const currentType = document.querySelector("#transaction-type").value;
  const categorySelect = document.querySelector("#transaction-category");
  const descriptionInput = document.querySelector("#description");
  const recurringWrap = document.querySelector("#recurring-check-wrap");

  const categoriesList = currentType === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  categorySelect.innerHTML = categoriesList.map((cat) => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`).join("");

  if (selectedCategory && categoriesList.includes(selectedCategory)) {
    categorySelect.value = selectedCategory;
  } else {
    categorySelect.value = categoriesList[0];
  }

  if (currentType === "income") {
    descriptionInput.placeholder = "e.g. Monthly salary, Client project payout, Dividend";
    if (recurringWrap) recurringWrap.hidden = false;
  } else {
    descriptionInput.placeholder = "e.g. Weekly groceries, Metro pass, Electricity bill";
    if (recurringWrap) recurringWrap.hidden = true;
  }
}

// Update Filter Category Dropdown
function updateFilterCategories() {
  const filterType = document.querySelector("#type-filter").value;
  const categoryFilter = document.querySelector("#category-filter");
  const currentVal = categoryFilter.value;

  let options = [];
  if (filterType === "expense") {
    options = EXPENSE_CATEGORIES;
  } else if (filterType === "income") {
    options = INCOME_CATEGORIES;
  } else {
    options = Array.from(new Set([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES]));
  }

  categoryFilter.innerHTML = '<option value="">All categories</option>' + options.map((cat) => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`).join("");
  if (options.includes(currentVal)) {
    categoryFilter.value = currentVal;
  }
}

function openForm(transaction = null) {
  editingId = transaction?.id ?? null;
  form.reset();
  document.querySelector("#form-error").textContent = "";
  document.querySelector("#dialog-title").textContent = transaction ? "Edit transaction" : "New transaction";
  document.querySelector("#save-transaction").innerHTML = transaction ? 'Save changes <span aria-hidden="true">↗</span>' : 'Save transaction <span aria-hidden="true">↗</span>';
  document.querySelector("#description").value = transaction?.description ?? "";
  document.querySelector("#amount").value = transaction?.amount ?? "";
  document.querySelector("#transaction-date").value = transaction?.date ?? new Date().toISOString().slice(0, 10);
  
  const currentType = transaction?.type ?? "expense";
  setType(currentType);
  updateCategoryDropdown(transaction?.category);

  dialog.showModal();
  document.querySelector("#description").focus();
}

function setType(type) {
  document.querySelector("#transaction-type").value = type;
  document.querySelectorAll(".type-option").forEach((button) => button.classList.toggle("selected", button.dataset.type === type));
  updateCategoryDropdown();
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2600);
}

document.querySelector("#add-transaction").addEventListener("click", () => openForm());
document.querySelector("#close-dialog").addEventListener("click", () => dialog.close());
document.querySelector("#cancel-dialog").addEventListener("click", () => dialog.close());
document.querySelectorAll(".type-option").forEach((button) => button.addEventListener("click", () => setType(button.dataset.type)));

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const isRecurring = document.querySelector("#is-recurring-income")?.checked || false;
  const payload = {
    description: document.querySelector("#description").value.trim(),
    amount: document.querySelector("#amount").value,
    type: document.querySelector("#transaction-type").value,
    category: document.querySelector("#transaction-category").value,
    date: document.querySelector("#transaction-date").value,
    is_recurring: isRecurring,
  };
  try {
    await requestJson(editingId ? `/api/transactions/${editingId}` : "/api/transactions", {
      method: editingId ? "PUT" : "POST",
      body: JSON.stringify(payload),
    });
    dialog.close();
    showToast(editingId ? "Transaction updated." : "Transaction added.");
    goalAlertDismissed = false;
    await refreshDashboard();
  } catch (error) {
    document.querySelector("#form-error").textContent = error.message;
  }
});

// Goals dialog wiring
const goalDialog = document.querySelector("#goal-dialog");
const goalForm = document.querySelector("#goal-form");
document.querySelector("#add-goal").addEventListener("click", () => {
  goalForm.reset();
  document.querySelector("#goal-saved").value = "0";
  document.querySelector("#goal-form-error").textContent = "";
  goalDialog.showModal();
  document.querySelector("#goal-name").focus();
});
document.querySelector("#close-goal-dialog").addEventListener("click", () => goalDialog.close());
document.querySelector("#cancel-goal-dialog").addEventListener("click", () => goalDialog.close());

goalForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    name: document.querySelector("#goal-name").value.trim(),
    target: document.querySelector("#goal-target").value,
    saved: document.querySelector("#goal-saved").value,
    deadline: document.querySelector("#goal-deadline").value,
  };
  try {
    await requestJson("/api/goals", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    goalDialog.close();
    showToast("Savings goal created.");
    goalAlertDismissed = false;
    await refreshDashboard();
  } catch (error) {
    document.querySelector("#goal-form-error").textContent = error.message;
  }
});

// Recurring salary dialog wiring
const recurringDialog = document.querySelector("#recurring-dialog");
const recurringForm = document.querySelector("#recurring-form");
document.querySelector("#add-recurring-btn").addEventListener("click", () => {
  recurringForm.reset();
  document.querySelector("#recurring-form-error").textContent = "";
  recurringDialog.showModal();
  document.querySelector("#recurring-title").focus();
});
document.querySelector("#close-recurring-dialog").addEventListener("click", () => recurringDialog.close());
document.querySelector("#cancel-recurring-dialog").addEventListener("click", () => recurringDialog.close());

recurringForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    title: document.querySelector("#recurring-title").value.trim(),
    amount: document.querySelector("#recurring-amount").value,
    category: document.querySelector("#recurring-category").value,
    day_of_month: document.querySelector("#recurring-day").value,
  };
  try {
    await requestJson("/api/recurring-incomes", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    recurringDialog.close();
    showToast("Monthly salary schedule saved and processed.");
    goalAlertDismissed = false;
    await refreshDashboard();
  } catch (error) {
    document.querySelector("#recurring-form-error").textContent = error.message;
  }
});

// Custom Confirmation Modal Helper
let confirmResolver = null;
const confirmDialog = document.querySelector("#confirm-dialog");
const confirmTitle = document.querySelector("#confirm-dialog-title");
const confirmMessage = document.querySelector("#confirm-dialog-message");
const confirmAccept = document.querySelector("#accept-confirm-dialog");

function askConfirmation({ title = "Are you sure?", message = "This action cannot be undone.", confirmText = "Yes, Delete" } = {}) {
  return new Promise((resolve) => {
    confirmResolver = resolve;
    if (confirmTitle) confirmTitle.textContent = title;
    if (confirmMessage) confirmMessage.textContent = message;
    if (confirmAccept) confirmAccept.innerHTML = `${escapeHtml(confirmText)} <span aria-hidden="true">↗</span>`;
    if (confirmDialog && typeof confirmDialog.showModal === "function") {
      confirmDialog.showModal();
    } else {
      resolve(window.confirm(`${title}\n${message}`));
    }
  });
}

document.querySelector("#accept-confirm-dialog")?.addEventListener("click", () => {
  if (confirmDialog) confirmDialog.close();
  if (confirmResolver) {
    confirmResolver(true);
    confirmResolver = null;
  }
});

document.querySelector("#cancel-confirm-dialog")?.addEventListener("click", () => {
  if (confirmDialog) confirmDialog.close();
  if (confirmResolver) {
    confirmResolver(false);
    confirmResolver = null;
  }
});

document.querySelector("#close-confirm-dialog")?.addEventListener("click", () => {
  if (confirmDialog) confirmDialog.close();
  if (confirmResolver) {
    confirmResolver(false);
    confirmResolver = null;
  }
});

document.querySelector("#recurring-list").addEventListener("click", async (event) => {
  const deleteBtn = event.target.closest("[data-delete-recurring]");
  const creditBtn = event.target.closest("[data-credit-recurring]");
  if (creditBtn) {
    try {
      const res = await requestJson(`/api/recurring-incomes/${creditBtn.dataset.creditRecurring}/credit-now`, { method: "POST" });
      showToast(res.message || "Salary credited for this month!");
      goalAlertDismissed = false;
      await refreshDashboard();
    } catch (error) {
      showToast(error.message);
    }
  }
  if (deleteBtn) {
    const title = deleteBtn.dataset.title || "this salary schedule";
    const ok = await askConfirmation({
      title: "Delete Salary Schedule?",
      message: `Are you sure you want to delete "${title}"? Automatic monthly credits will stop.`,
      confirmText: "Delete Schedule",
    });
    if (ok) {
      try {
        await requestJson(`/api/recurring-incomes/${deleteBtn.dataset.deleteRecurring}`, { method: "DELETE" });
        showToast("Salary schedule removed.");
        goalAlertDismissed = false;
        await refreshDashboard();
      } catch (error) {
        showToast(error.message);
      }
    }
  }
});

document.querySelector("#goals-list").addEventListener("click", async (event) => {
  const contributeButton = event.target.closest("[data-contribute-goal]");
  const deleteButton = event.target.closest("[data-delete-goal]");
  if (contributeButton) {
    const raw = window.prompt(`How much would you like to add to "${contributeButton.dataset.goalName}"?`, "100");
    if (raw === null) return;
    const amount = Number(raw.trim());
    if (!amount || amount <= 0) {
      showToast("Enter a valid contribution greater than zero.");
      return;
    }
    try {
      await requestJson(`/api/goals/${contributeButton.dataset.contributeGoal}/contributions`, {
        method: "POST",
        body: JSON.stringify({ amount }),
      });
      showToast("Savings contribution added.");
      goalAlertDismissed = false;
      await refreshDashboard();
    } catch (error) {
      showToast(error.message);
    }
  }
  if (deleteButton) {
    const name = deleteButton.dataset.name || "this goal";
    const ok = await askConfirmation({
      title: "Delete Savings Goal?",
      message: `Are you sure you want to delete "${name}"?`,
      confirmText: "Delete Goal",
    });
    if (ok) {
      try {
        await requestJson(`/api/goals/${deleteButton.dataset.deleteGoal}`, { method: "DELETE" });
        showToast("Savings goal deleted.");
        goalAlertDismissed = false;
        await refreshDashboard();
      } catch (error) {
        showToast(error.message);
      }
    }
  }
});

document.querySelector("#dismiss-goal-alert").addEventListener("click", () => {
  goalAlertDismissed = true;
  document.querySelector("#goal-alert").hidden = true;
});

document.querySelector("#transaction-rows").addEventListener("click", async (event) => {
  const editButton = event.target.closest("[data-edit]");
  const deleteButton = event.target.closest("[data-delete]");
  if (editButton) {
    try {
      const transactions = await requestJson("/api/transactions");
      const transaction = transactions.find((item) => item.id === Number(editButton.dataset.edit));
      if (transaction) openForm(transaction);
    } catch (error) {
      showToast(error.message);
    }
  }
  if (deleteButton) {
    const desc = deleteButton.dataset.desc || "this transaction";
    const ok = await askConfirmation({
      title: "Delete Transaction?",
      message: `Are you sure you want to delete "${desc}"? This cannot be undone.`,
      confirmText: "Delete",
    });
    if (ok) {
      try {
        await requestJson(`/api/transactions/${deleteButton.dataset.delete}`, { method: "DELETE" });
        showToast("Transaction deleted.");
        goalAlertDismissed = false;
        await refreshDashboard();
      } catch (error) {
        showToast(error.message);
      }
    }
  }
});

// Clear All Transactions Button
document.querySelector("#clear-all-data-btn")?.addEventListener("click", async () => {
  const ok = await askConfirmation({
    title: "Clear All Transactions?",
    message: "This will permanently delete all transactions from your ledger. Are you sure you want to wipe all transaction data?",
    confirmText: "Yes, Clear All Data",
  });
  if (ok) {
    try {
      await requestJson("/api/transactions/clear-all", { method: "POST" });
      showToast("All transactions cleared.");
      goalAlertDismissed = false;
      await refreshDashboard();
    } catch (error) {
      showToast(error.message);
    }
  }
});

document.querySelector("#clear-filters").addEventListener("click", () => {
  document.querySelector("#search-filter").value = "";
  document.querySelector("#type-filter").value = "";
  document.querySelector("#category-filter").value = "";
  document.querySelector("#from-filter").value = "";
  document.querySelector("#to-filter").value = "";
  updateFilterCategories();
  refreshDashboard();
});

document.querySelector("#type-filter").addEventListener("change", () => {
  updateFilterCategories();
  refreshDashboard();
});

document.querySelector("#export-data").addEventListener("click", async () => {
  try {
    const transactions = await requestJson("/api/transactions");
    const columns = ["date", "description", "category", "type", "amount"];
    const csv = [columns.join(","), ...transactions.map((transaction) => columns.map((column) => {
      const value = String(transaction[column]).replaceAll('"', '""');
      return `"${value}"`;
    }).join(","))].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const download = document.createElement("a");
    download.href = url;
    download.download = "ledgerly-transactions.csv";
    download.click();
    URL.revokeObjectURL(url);
    showToast("Your transactions were exported.");
  } catch (error) {
    showToast(error.message);
  }
});

let searchTimer;
document.querySelector("#search-filter").addEventListener("input", () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(refreshDashboard, 180);
});
document.querySelectorAll("#category-filter, #from-filter, #to-filter").forEach((input) => input.addEventListener("change", refreshDashboard));

window.addEventListener("resize", () => {
  if (currentSummary) {
    renderChart();
  }
});

document.querySelector("#today-label").textContent = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }).toUpperCase();
updateFilterCategories();
refreshDashboard();