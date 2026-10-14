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
let modrinthOffset = 0;
let modrinthTotal = 0;
let requestVersion = 0;
let loadingMore = false;
const PAGE_SIZE = 100;
const loadMoreButton = document.createElement("button");
loadMoreButton.id = "load-more-projects";
loadMoreButton.className = "btn";
loadMoreButton.type = "button";
loadMoreButton.textContent = "Load more projects ↓";
loadMoreButton.hidden = true;
loadMoreButton.style.display = "block";
loadMoreButton.style.margin = "24px auto 0";
grid.insertAdjacentElement("afterend", loadMoreButton);

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
      <span class="review-state">${escapeHtml(project.source_name || (project.status === "published" ? "Craftora" : "Pending review"))}</span></div>
      ${project.source_url ? '<a class="source-link" href="' + escapeHtml(project.source_url) + '" target="_blank" rel="noopener noreferrer">Project website ↗</a>' : ""}
    </article>`;
  }).join("");
}

async function loadProjects({ append = false } = {}) {
  if (loadingMore) return;
  const version = ++requestVersion;
  const term = $("#search").value.trim();
  if (!append) {
    modrinthOffset = 0;
    modrinthTotal = 0;
    loadMoreButton.hidden = true;
    grid.innerHTML = '<div class="empty"><h3>Discovering Minecraft projects…</h3><p>Searching public project listings and Craftora submissions.</p></div>';
    $("#result-count").textContent = "Searching public catalogues…";
  } else {
    loadingMore = true;
    loadMoreButton.disabled = true;
    loadMoreButton.textContent = "Loading more…";
  }
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(modrinthOffset), index: "downloads" });
  if (term) params.set("query", term);
  if (activeCategory !== "all") {
    const facetType = ["plugin", "datapack"].includes(activeCategory) ? "all_project_types" : "project_type";
    params.set("facets", JSON.stringify([[facetType + ":" + activeCategory]]));
  }

  const [modrinthResult, communityResult] = await Promise.allSettled([
    fetch("https://api.modrinth.com/v2/search?" + params.toString()).then(async (response) => {
      if (!response.ok) throw new Error("Modrinth returned " + response.status);
      return response.json();
    }),
    (!append && supabaseReady) ? (async () => {
      let request = supabase.from("projects")
        .select("id,title,summary,project_type,icon_url,source_url,game_versions,loaders,status,profiles(username)")
        .eq("status", "published")
        .order("created_at", { ascending: false })
        .limit(60);
      if (activeCategory !== "all") request = request.eq("project_type", activeCategory);
      if (term) {
        const safeTerm = term.replace(/[,%()]/g, " ");
        request = request.or("title.ilike.%" + safeTerm + "%,summary.ilike.%" + safeTerm + "%");
      }
      const { data, error } = await request;
      if (error) throw error;
      return (data || []).map((project) => ({
        ...project,
        author_name: project.profiles?.username || "Craftora creator",
        source_name: "Craftora",
        status: "published"
      }));
    })() : Promise.resolve([])
  ]);

  if (version !== requestVersion) { loadingMore = false; return; }
  let publicProjects = [];
  if (modrinthResult.status === "fulfilled") {
    modrinthTotal = Number(modrinthResult.value.total_hits || 0);
    publicProjects = (modrinthResult.value.hits || []).map((project) => ({
      id: "modrinth-" + project.project_id,
      title: project.title,
      summary: project.description,
      project_type: project.project_type,
      all_project_types: project.all_project_types || [project.project_type],
      icon_url: project.icon_url,
      source_url: "https://modrinth.com/project/" + (project.slug || project.project_id),
      game_versions: project.versions || [],
      loaders: (project.categories || []).filter((category) =>
        ["fabric", "forge", "neoforge", "quilt", "paper", "folia", "purpur", "velocity", "bukkit", "spigot"].includes(category.toLowerCase())
      ),
      author_name: project.author || "Modrinth creator",
      status: "published",
      source_name: "Modrinth",
      downloads: project.downloads || 0
    }));
  }

  let communityProjects = [];
  if (communityResult.status === "fulfilled") {
    communityProjects = communityResult.value;
  } else {
    console.warn("Craftora community catalogue error:", communityResult.reason?.message || communityResult.reason);
  }

  const matchesCategory = (project) => activeCategory === "all" ||
    project.project_type === activeCategory ||
    (Array.isArray(project.all_project_types) && project.all_project_types.includes(activeCategory));
  const combined = [...communityProjects, ...publicProjects.filter(matchesCategory)];
  const seen = new Set();
  const incoming = combined.filter((project) => {
    const key = project.source_url || project.id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const existing = append ? Array.from(grid.querySelectorAll(".project-card")).map((card) => card.dataset.sourceUrl).filter(Boolean) : [];
  const existingSet = new Set(existing);
  const projects = incoming.filter((project) => {
    const key = project.source_url || project.id;
    if (existingSet.has(key)) return false;
    existingSet.add(key);
    return true;
  });

  if (!projects.length && !append) {
    const publicFailed = modrinthResult.status === "rejected";
    grid.innerHTML = '<div class="empty"><span class="empty-icon">✦</span><h3>' +
      (publicFailed ? "Could not reach the public catalogue" : "No matching projects found") +
      '</h3><p>' +
      (publicFailed
        ? "The public project service may be temporarily unavailable. Check your connection and try again."
        : "Try a different search or category. Craftora also welcomes community submissions.") +
      '</p><button class="btn" type="button" id="retry-projects">Try again ↻</button></div>';
    $("#retry-projects").addEventListener("click", loadProjects);
    $("#result-count").textContent = publicFailed ? "Catalogue temporarily unavailable" : "0 projects";
    loadingMore = false;
    loadMoreButton.disabled = false;
    loadMoreButton.textContent = "Load more projects ↓";
    return;
  }

  projects.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
  if (append) {
    if (projects.length) {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = projects.map((project) => {
        const icon = project.icon_url
          ? '<img src="' + escapeHtml(project.icon_url) + '" alt="" loading="lazy" onerror="this.parentElement.textContent=\\\'C\\\'">'
          : escapeHtml((project.title || "C").slice(0, 1).toUpperCase());
        const versions = Array.isArray(project.game_versions) ? project.game_versions.slice(0, 2) : [];
        const loaders = Array.isArray(project.loaders) ? project.loaders.slice(0, 2) : [];
        return `<article class="project-card" data-source-url="${escapeHtml(project.source_url || project.id)}">
          <div class="card-top"><div class="project-icon">${icon}</div><div class="project-heading"><span class="type-label">${escapeHtml(categoryLabel(project.project_type))}</span><h3>${escapeHtml(project.title)}</h3></div></div>
          <p class="summary">${escapeHtml(project.summary || "A Minecraft community project.")}</p>
          <div class="pills">${versions.map((v) => '<span class="pill">MC ' + escapeHtml(v) + '</span>').join("")}${loaders.map((v) => '<span class="pill">' + escapeHtml(v) + '</span>').join("")}</div>
          <div class="card-footer"><span>By ${escapeHtml(project.author_name || "Craftora creator")}</span><span class="review-state">${escapeHtml(project.source_name || "Modrinth")}</span></div>
          ${project.source_url ? '<a class="source-link" href="' + escapeHtml(project.source_url) + '" target="_blank" rel="noopener noreferrer">Project website ↗</a>' : ""}
        </article>`;
      }).join("");
      grid.insertAdjacentHTML("beforeend", wrapper.innerHTML);
    }
  } else {
    renderProjects(projects);
    Array.from(grid.querySelectorAll(".project-card")).forEach((card, index) => {
      if (projects[index]) card.dataset.sourceUrl = projects[index].source_url || projects[index].id;
    });
  }
  modrinthOffset += (modrinthResult.status === "fulfilled" ? (modrinthResult.value.hits || []).length : 0);
  const displayed = grid.querySelectorAll(".project-card").length;
  $("#result-count").textContent = displayed + " projects shown · " + (modrinthTotal ? modrinthTotal.toLocaleString() + " Modrinth search matches" : "live public listings") + (communityProjects.length ? " + Craftora" : "");
  loadMoreButton.hidden = modrinthResult.status !== "fulfilled" || modrinthOffset >= modrinthTotal || (modrinthResult.value.hits || []).length === 0;
  loadingMore = false;
  loadMoreButton.disabled = false;
  loadMoreButton.textContent = loadMoreButton.hidden ? "You’ve reached the end of these results" : "Load more projects ↓";
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

loadMoreButton.addEventListener("click", () => loadProjects({ append: true }));

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
