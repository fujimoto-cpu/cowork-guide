/* Chart.js ラッパー — ダッシュボード用 */

const CHART_COLORS = {
  creative: "#EC4899",
  pm: "#3B82F6",
  backoffice: "#10B981",
  sales: "#F59E0B",
  cross: "#8B5CF6",
};

const DEFAULT_FONT = {
  family: "Inter, 'Noto Sans JP', sans-serif",
  size: 12,
};

function setChartDefaults() {
  if (!window.Chart) return;
  Chart.defaults.font = DEFAULT_FONT;
  Chart.defaults.color = "#4B5563";
  Chart.defaults.borderColor = "#E7E2D5";
}

function donutByRole(ctx, cards) {
  const totals = {};
  for (const c of cards) {
    const roles = (c.role || []).length ? c.role : ["cross"];
    const split = (c.monthly_saved_minutes || 0) / roles.length;
    for (const r of roles) totals[r] = (totals[r] || 0) + split;
  }
  const labels = Object.keys(totals);
  const data = labels.map((r) => Math.round((totals[r] / 60) * 10) / 10);
  return new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: labels.map((r) => {
        const meta = window.ROLE_LABELS ? window.ROLE_LABELS[r] : null;
        return meta ? `${meta.icon} ${meta.label}` : r;
      }),
      datasets: [
        {
          data,
          backgroundColor: labels.map((r) => CHART_COLORS[r] || "#999"),
          borderColor: "#fff",
          borderWidth: 3,
          hoverOffset: 12,
        },
      ],
    },
    options: {
      responsive: true,
      cutout: "60%",
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12, padding: 12 } },
        tooltip: {
          callbacks: { label: (c) => ` ${c.label}: ${c.parsed}h / 月` },
        },
      },
      animation: { duration: 1200 },
    },
  });
}

function barRanking(ctx, cards) {
  const ranking = {};
  for (const c of cards) {
    if (!c.person) continue;
    ranking[c.person] = (ranking[c.person] || 0) + (c.monthly_saved_minutes || 0);
  }
  const sorted = Object.entries(ranking).sort((a, b) => b[1] - a[1]);
  const labels = sorted.map(([p]) => p);
  const data = sorted.map(([, m]) => Math.round((m / 60) * 10) / 10);
  const colors = labels.map((_, i) => {
    if (i === 0) return "#FCD34D";
    if (i === 1) return "#D1D5DB";
    if (i === 2) return "#FCA56C";
    return "#A5B4FC";
  });
  return new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "月間削減時間（h）",
          data,
          backgroundColor: colors,
          borderRadius: 8,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, ticks: { callback: (v) => `${v}h` } },
      },
      animation: { duration: 1400 },
    },
  });
}

function gaugeBenchmark(ctx, currentH, targetH = 50) {
  const pct = Math.min(100, (currentH / targetH) * 100);
  return new Chart(ctx, {
    type: "doughnut",
    data: {
      datasets: [
        {
          data: [pct, 100 - pct],
          backgroundColor: [
            pct >= 100 ? "#10B981" : "#EC4899",
            "#F3F4F6",
          ],
          borderWidth: 0,
          circumference: 220,
          rotation: 250,
        },
      ],
    },
    options: {
      responsive: true,
      cutout: "70%",
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      animation: { duration: 1400 },
    },
    plugins: [
      {
        id: "centerText",
        beforeDraw(chart) {
          const { ctx, chartArea } = chart;
          ctx.save();
          ctx.font = "700 22px Inter, sans-serif";
          ctx.textAlign = "center";
          ctx.fillStyle = "#1F2937";
          const cx = (chartArea.left + chartArea.right) / 2;
          const cy = (chartArea.top + chartArea.bottom) / 2 + 6;
          ctx.fillText(`${currentH.toFixed(1)}h`, cx, cy);
          ctx.font = "500 11px Inter, sans-serif";
          ctx.fillStyle = "#6B7280";
          ctx.fillText(`/ 月 GMO基準 ${targetH}h`, cx, cy + 20);
          ctx.restore();
        },
      },
    ],
  });
}

function tagCloud(ctx, cards) {
  const counts = {};
  for (const c of cards) {
    for (const t of c.tags || []) counts[t] = (counts[t] || 0) + 1;
  }
  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  return new Chart(ctx, {
    type: "bar",
    data: {
      labels: sorted.map(([t]) => t),
      datasets: [
        {
          label: "登録件数",
          data: sorted.map(([, n]) => n),
          backgroundColor: "#8B5CF6",
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
      animation: { duration: 1200 },
    },
  });
}

window.V2Charts = { setChartDefaults, donutByRole, barRanking, gaugeBenchmark, tagCloud };
