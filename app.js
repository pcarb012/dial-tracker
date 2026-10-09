// The four things we count. Each name matches a data-key in index.html
// and a column in the Supabase "days" and "goals" tables.
const KEYS = ["dials", "conversations", "appointments", "messages"];

// Daily goals to start with. You can change them in the app.
const DEFAULT_GOALS = {
  dials: 100,
  conversations: 10,
  appointments: 1,
  messages: 20,
};

// The connection to your Supabase project, using the values in config.js.
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// What the app is holding right now. Filled from Supabase after sign-in.
let user = null;
let days = {};
let goals = { ...DEFAULT_GOALS };

// The chart, once it's drawn. Starts empty.
let chart = null;

// Saves wait in line here, so they reach Supabase in the order you tapped.
let saving = Promise.resolve();

// Turn a date into text like "2026-10-08", using your own time zone.
function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Today's date as text, like "2026-10-08".
function todayKey() {
  return dateKey(new Date());
}

// The dates of the last few days, oldest first, ending today.
function lastDays(howMany) {
  const dates = [];
  for (let back = howMany - 1; back >= 0; back--) {
    const date = new Date();
    date.setDate(date.getDate() - back);
    dates.push(date);
  }
  return dates;
}

// Load the last 30 days and your goals from Supabase.
async function loadData() {
  const firstDay = dateKey(lastDays(30)[0]);
  const dayResult = await db.from("days").select("*").gte("day", firstDay);
  const goalResult = await db.from("goals").select("*").maybeSingle();
  if (dayResult.error || goalResult.error) {
    alert("Couldn't load your numbers. Check your internet and refresh.");
    return;
  }

  days = {};
  for (const row of dayResult.data) {
    days[row.day] = row;
  }
  goals = { ...DEFAULT_GOALS, ...(goalResult.data || {}) };
}

// Send one save to Supabase, after any saves already waiting.
function queueSave(sendToSupabase) {
  saving = saving.then(async () => {
    const { error } = await sendToSupabase();
    if (error) {
      alert("Couldn't save to Supabase. Check your internet and try again.");
    }
  });
}

// Get today's counts, starting at 0 for anything not counted yet.
function todayCounts() {
  const counts = days[todayKey()] || {};
  const result = {};
  for (const key of KEYS) {
    result[key] = counts[key] || 0;
  }
  return result;
}

// Put today's numbers, bars and goals on the screen.
function showCounts() {
  const counts = todayCounts();
  for (const key of KEYS) {
    const card = document.querySelector(`.card[data-key="${key}"]`);
    const count = counts[key];
    const goal = goals[key];
    const percent = Math.min(100, Math.round((count / goal) * 100));

    card.querySelector(".count").textContent = count;
    card.querySelector(".progress-fill").style.width = `${percent}%`;
    card.querySelector(".goal-text").textContent = `${percent}% of ${goal}`;
    card.classList.toggle("done", count >= goal);
  }
}

// Add (or take away) from one counter, show it, and save it.
function changeCount(key, amount) {
  const day = todayKey();
  const counts = todayCounts();
  counts[key] = Math.max(0, counts[key] + amount);
  days = { ...days, [day]: counts };
  refresh();
  queueSave(() => db.from("days").upsert({ user_id: user.id, day: day, ...counts }));
}

// Ask for a new goal for one counter, show it, and save it.
function editGoal(key) {
  const answer = prompt("New daily goal:", goals[key]);
  if (answer === null) return; // You pressed Cancel.

  const newGoal = parseInt(answer, 10);
  if (!(newGoal > 0)) {
    alert("Please enter a whole number above 0.");
    return;
  }
  goals = { ...goals, [key]: newGoal };
  refresh();
  const row = { user_id: user.id };
  for (const name of KEYS) {
    row[name] = goals[name];
  }
  queueSave(() => db.from("goals").upsert(row));
}

// Draw (or redraw) the history chart for the chosen counter and range.
function drawChart() {
  const metric = document.getElementById("metric").value;
  const range = Number(document.getElementById("range").value);
  const goal = goals[metric];
  const dates = lastDays(range);

  const labels = dates.map((date) =>
    date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  );
  const values = dates.map((date) => (days[dateKey(date)] || {})[metric] || 0);
  const colors = values.map((value) => (value >= goal ? "#788c5d" : "#d97757"));

  if (chart) {
    chart.data.labels = labels;
    chart.data.datasets[0].data = values;
    chart.data.datasets[0].backgroundColor = colors;
    chart.update();
    return;
  }

  Chart.defaults.font.family = "Lora, Georgia, serif";
  Chart.defaults.color = "#141413";
  chart = new Chart(document.getElementById("chart"), {
    type: "bar",
    data: {
      labels: labels,
      datasets: [{ data: values, backgroundColor: colors, borderRadius: 4 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "#e8e6dc" } },
      },
    },
  });
}

// Update the date, the cards and the chart together.
function refresh() {
  showDate();
  showCounts();
  drawChart();
}

// Show the app if you're signed in, or the sign-in box if not.
async function showScreen(session) {
  user = session ? session.user : null;
  document.getElementById("signin").hidden = Boolean(user);
  document.getElementById("app").hidden = !user;
  document.getElementById("signout").hidden = !user;
  if (user) {
    await loadData();
    refresh();
  }
}

// Show a message in the sign-in box. Errors get an orange mark.
function showSignInMessage(text, isError) {
  const message = document.getElementById("signin-message");
  message.textContent = text;
  message.classList.toggle("error", isError);
}

// Sign in with the email and password you typed.
async function signIn(event) {
  event.preventDefault(); // Stop the page from reloading.
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  showSignInMessage("Signing in…", false);

  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error) {
    showSignInMessage(`Couldn't sign in: ${error.message}`, true);
    return;
  }
  await showScreen(data.session);
}

// Create your account the first time, using the email and password you typed.
async function signUp() {
  const form = document.getElementById("signin-form");
  if (!form.reportValidity()) return; // Shows what's missing.
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  showSignInMessage("Creating your account…", false);

  const { data, error } = await db.auth.signUp({ email, password });
  if (error) {
    showSignInMessage(`Couldn't create the account: ${error.message}`, true);
    return;
  }
  if (!data.session) {
    showSignInMessage("Account made, but Supabase wants the email confirmed. Turn off Confirm email (step 9), then sign in.", true);
    return;
  }
  await showScreen(data.session);
}

// Sign out and go back to the sign-in box.
async function signOut() {
  await saving; // Finish any saves first.
  await db.auth.signOut();
  days = {};
  goals = { ...DEFAULT_GOALS };
  showSignInMessage("Signed out. Sign in with your email and password.", false);
  await showScreen(null);
}

// When you come back to the app (say, from your phone), fetch the latest numbers.
async function reloadWhenVisible() {
  if (document.visibilityState !== "visible" || !user) return;
  await saving;
  await loadData();
  refresh();
}

// Add a progress bar and a goal line to every card.
function addGoalParts() {
  for (const key of KEYS) {
    const card = document.querySelector(`.card[data-key="${key}"]`);
    const buttons = card.querySelector(".buttons");

    const progress = document.createElement("div");
    progress.className = "progress";
    progress.innerHTML = '<div class="progress-fill"></div>';

    const goalLine = document.createElement("p");
    goalLine.className = "goal-line";
    goalLine.innerHTML =
      '<span class="goal-text"></span><button class="goal-button">Edit goal</button>';
    goalLine.querySelector(".goal-button").addEventListener("click", () => editGoal(key));

    card.insertBefore(progress, buttons);
    card.insertBefore(goalLine, buttons);
  }
}

// Show today's date in the header, like "Thursday, October 8".
function showDate() {
  const text = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  document.getElementById("today").textContent = text;
}

// Hook up every button, drop-down and form.
function setUpControls() {
  for (const key of KEYS) {
    const card = document.querySelector(`.card[data-key="${key}"]`);
    card.querySelector(".plus").addEventListener("click", () => changeCount(key, 1));
    card.querySelector(".minus").addEventListener("click", () => changeCount(key, -1));
  }
  document.getElementById("metric").addEventListener("change", drawChart);
  document.getElementById("range").addEventListener("change", drawChart);
  document.getElementById("signin-form").addEventListener("submit", signIn);
  document.getElementById("signup-button").addEventListener("click", signUp);
  document.getElementById("signout").addEventListener("click", signOut);
  document.addEventListener("visibilitychange", reloadWhenVisible);
}

// Start up: build the cards, hook up the controls, and check if you're signed in.
async function start() {
  showDate();
  addGoalParts();
  setUpControls();
  const { data } = await db.auth.getSession();
  await showScreen(data.session);
}

start();
