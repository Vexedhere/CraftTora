import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

const $ = (selector) => document.querySelector(selector);
const grid = $("#projects");
const notice = $("#notice");
const supabaseReady = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
const supabase = supabaseReady ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY) : null;
const categories = ["all", "mod", "modpack", "plugin", "shader", "resourcepack", "datapack"];
let activeCategory = "all";
let currentUser = null;
let searchTimer;

const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));
const categoryLabel = (value) => ({
  all: "All projects", mod: "Mods", modpack: "Modpacks", plugin: "Plugins",
  shader: "Shaders", resourcepack: "Resource packs", datapack: "Datapacks"
}[value] || value);

function showNotice(message, kind = "info") {
  notice.textContent = message;
  notice.dataset.kind = kind;
  notice.hidden = false;
}
function hideNotice() { notice.hidden = true; }

function renderProjects(projects) {
  if (!projects.length) {
    grid.innerHTML = '<div class="empty"><span class="empty-icon">✦</span><h3>No projects found yet</h3><p>Try another search, or be one of the first creators to submit a project.</p></div>';
    return;
  }
  grid.innerHTML = projects.map((project) => {
    const icon = project.icon_url
      ? '<img src="' + escapeHtml(project.icon_url) + '" alt="" loading="lazy" onerror="this.parentElement.textContent=\'C\'">'
      : escapeHtml((project.title || "C").slice(0, 1).toUpperCase());
    const versions = Array.isArray(project.game_versions) ? project.game_versions.slice(0, 2) : [];
    const loaders = Array.isArray(project.loaders) ? project.loaders.slice(0, 2) : [];
    return `<article class="project-card">
      <div class="card-top"><div class="project-icon">${icon}</div><div class="project-heading">
      <span class="type-label">${escapeHtml(categoryLabel(project.project_type))}</span>
      <h3>${escapeHtml(project.title)}</h3></div></div>
      <p class="summary">${escapeHtml(project.summary || "A Minecraft community project.")}</p>
      <div class="pills">${versions.map((v) => '<span class="pill">MC ' + escapeHtml(v) + '</span>').join("")}${loaders.map((v) => '<span class="pill">' + escapeHtml(v) + '</span>').join("")}</div>
      <div class="card-footer"><span>By ${escapeHtml(project.author_name || "Craftora creator")}</span>
      <span class="review-state">${project.status === "published" ? "Published" : "Pending review"}</span></div>
      ${project.source_url ? '<a class="source-link" href="' + escapeHtml(project.source_url) + '" target="_blank" rel="noopener noreferrer">Project website ↗</a>' : ""}
    </article>`;
  }).join("");
}

async function loadProjects() {
  if (!supabaseReady) {
    grid.innerHTML = '<div class="empty setup-empty"><span class="empty-icon">⚙</span><h3>Connect Craftora to its own database</h3><p>The independent catalogue is ready for its backend. Add your Supabase URL and publishable key in <code>assets/js/config.js</code>, then apply the SQL migration in <code>supabase/migrations</code>.</p><a class="text-link" href="README.md">Open setup guide ↗</a></div>';
    $("#result-count").textContent = "Backend not configured";
    return;
  }

  grid.innerHTML = '<div class="empty"><h3>Loading Craftora projects…</h3><p>Searching Craftora’s own catalogue.</p></div>';
  let request = supabase.from("projects")
    .select("id,title,summary,project_type,icon_url,source_url,game_versions,loaders,status,profiles(username)")
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(60);

  if (activeCategory !== "all") request = request.eq("project_type", activeCategory);
  const term = $("#search").value.trim();
  if (term) request = request.or("title.ilike.%" + term.replace(/[,%()]/g, " ") + "%,summary.ilike.%" + term.replace(/[,%()]/g, " ") + "%");

  const { data, error } = await request;
  if (error) {
    grid.innerHTML = '<div class="empty"><h3>Could not load projects</h3><p>Check your Supabase setup and Row Level Security policies, then try again.</p></div>';
    $("#result-count").textContent = "Catalogue unavailable";
    console.error("Craftora catalogue error:", error.message);
    return;
  }
  const projects = (data || []).map((project) => ({
    ...project,
    author_name: project.profiles?.username || "Craftora creator"
  }));
  renderProjects(projects);
  $("#result-count").textContent = projects.length + (projects.length === 1 ? " project" : " projects");
}

function renderCategories() {
  $("#categories").innerHTML = categories.map((category) =>
    '<button class="category-chip' + (category === activeCategory ? " active" : "") + '" type="button" data-category="' + category + '">' + categoryLabel(category) + "</button>"
  ).join("");
  $("#categories").querySelectorAll("[data-category]").forEach((button) => {
    button.addEventListener("click", () => {
      activeCategory = button.dataset.category;
      renderCategories();
      loadProjects();
    });
  });
}

function updateAuthUi() {
  $("#account-status").textContent = currentUser ? "Signed in" : "Creator sign in";
  $("#sign-out").hidden = !currentUser;
  $("#auth-open").hidden = Boolean(currentUser);
  $("#submit-open").disabled = !currentUser;
  $("#submit-open").title = currentUser ? "Submit a project" : "Sign in to submit a project";
}

async function refreshUser() {
  if (!supabase) return;
  const { data } = await supabase.auth.getUser();
  currentUser = data.user || null;
  updateAuthUi();
}

$("#search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadProjects, 300);
});
$("#auth-open").addEventListener("click", () => $("#auth-dialog").showModal());
$("#auth-close").addEventListener("click", () => $("#auth-dialog").close());
$("#submit-open").addEventListener("click", () => {
  if (!currentUser) {
    $("#auth-dialog").showModal();
    showNotice("Sign in first to submit a project.", "info");
    return;
  }
  $("#project-dialog").showModal();
});
$("#project-close").addEventListener("click", () => $("#project-dialog").close());

$("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase) return showNotice("Add the Supabase URL and publishable key to assets/js/config.js first.", "error");
  const email = $("#auth-email").value.trim();
  const password = $("#auth-password").value;
  const mode = new FormData(event.currentTarget).get("auth-mode");
  const result = mode === "signup"
    ? await supabase.auth.signUp({ email, password })
    : await supabase.auth.signInWithPassword({ email, password });
  if (result.error) return showNotice(result.error.message, "error");
  await refreshUser();
  if (mode === "signup" && !result.data.session) {
    showNotice("Account created. Check your email to confirm it, then sign in.", "success");
  } else {
    $("#auth-dialog").close();
    showNotice("You are signed in. Project submissions enter the review queue.", "success");
  }
});

$("#sign-out").addEventListener("click", async () => {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) return showNotice(error.message, "error");
  currentUser = null;
  updateAuthUi();
  showNotice("You have signed out.", "success");
});

$("#project-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase || !currentUser) return showNotice("Sign in before submitting a project.", "error");
  const form = new FormData(event.currentTarget);
  const slug = String(form.get("title")).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);
  const project = {
    owner_id: currentUser.id,
    title: String(form.get("title")).trim(),
    slug,
    summary: String(form.get("summary")).trim(),
    description: String(form.get("description") || "").trim(),
    project_type: String(form.get("project_type")),
    source_url: String(form.get("source_url") || "").trim() || null,
    game_versions: String(form.get("game_versions") || "").split(",").map((v) => v.trim()).filter(Boolean).slice(0, 20),
    loaders: String(form.get("loaders") || "").split(",").map((v) => v.trim()).filter(Boolean).slice(0, 10),
    status: "pending"
  };
  const submit = $("#project-submit");
  submit.disabled = true;
  submit.textContent = "Submitting…";
  const { error } = await supabase.from("projects").insert(project);
  submit.disabled = false;
  submit.textContent = "Submit for review";
  if (error) return showNotice(error.message, "error");
  $("#project-dialog").close();
  event.currentTarget.reset();
  showNotice("Project submitted! It will appear publicly after moderation approves it.", "success");
});

renderCategories();
updateAuthUi();
if (supabase) {
  supabase.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user || null;
    updateAuthUi();
  });
  refreshUser();
}
loadProjects();
