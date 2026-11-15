import { escapeHtml, StorageUtil } from "./state.js";
import { LOCAL_STORAGE_KEYS } from "./config.js";

const $ = (id) => document.getElementById(id);

const DEFAULT_POSTS = [
  {
    id: 1,
    category: "본사공지",
    title: "WM RESEARCH DESK 포털 오픈 및 활용 안내",
    author: "F/O 본사 솔루션팀",
    date: "2026.01.01",
    content:
      "PB 및 패밀리오피스 본사 직원을 위한 데일리 마켓 브리핑 포털입니다. 종합 대시보드의 손님 전달용 PDF 보고서 다운로드 기능을 상담에 적극 활용해 주시기 바랍니다.\n\n※ 이 게시판은 브라우저(기기) 로컬에만 저장됩니다. 다른 PC와 공유되지 않으니, 공유가 필요한 공지는 별도 사내 메신저/메일도 함께 활용해 주세요.",
  },
];

function getPosts() {
  const saved = StorageUtil.get(LOCAL_STORAGE_KEYS.boardPosts, null);
  if (!saved) {
    StorageUtil.set(LOCAL_STORAGE_KEYS.boardPosts, DEFAULT_POSTS);
    return DEFAULT_POSTS;
  }
  return saved;
}

function savePosts(posts) {
  StorageUtil.set(LOCAL_STORAGE_KEYS.boardPosts, posts);
}

export function renderBoard() {
  const tbody = $("board-list-body");
  if (!tbody) return;
  tbody.innerHTML = getPosts()
    .map(
      (p) => `
      <tr style="cursor:pointer;" data-post-id="${p.id}">
        <td><span class="badge-tag tag-macro">${escapeHtml(p.category)}</span></td>
        <td style="font-weight:600; color:#9DB0DC;">${escapeHtml(p.title)}</td>
        <td>${escapeHtml(p.author)}</td>
        <td style="color:#9DADAA;">${escapeHtml(p.date)}</td>
      </tr>
    `
    )
    .join("");
}

function viewPost(id) {
  const post = getPosts().find((p) => p.id === id);
  const box = $("board-detail-view");
  if (!post || !box) return;
  box.classList.add("open");
  box.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
      <span class="badge-tag tag-macro">${escapeHtml(post.category)}</span>
      <span style="font-size:12px; color:#9DADAA;">작성자: ${escapeHtml(post.author)} | 등록일: ${escapeHtml(post.date)}</span>
    </div>
    <h4 style="font-size:16px; font-weight:700; color:#9DB0DC; margin-bottom:10px;">${escapeHtml(post.title)}</h4>
    <p style="font-size:14px; color:#DCE4E2; line-height:1.6; white-space:pre-wrap; margin-bottom:12px;">${escapeHtml(post.content)}</p>
    <div style="text-align:right;">
      <button type="button" id="btn-delete-post" data-post-id="${post.id}" data-post-author="${escapeHtml(post.author)}" style="background:#ef4444; color:#fff; border:none; padding:5px 10px; border-radius:4px; font-size:12px; cursor:pointer;">게시글 삭제</button>
    </div>
  `;
}

export function initBoardEvents() {
  $("btn-toggle-write").addEventListener("click", () => $("board-write-form").classList.toggle("open"));
  $("btn-cancel-write").addEventListener("click", () => $("board-write-form").classList.remove("open"));

  $("btn-save-post").addEventListener("click", () => {
    const category = $("post-category").value;
    const author = $("post-author").value.trim() || "F/O 본사";
    const title = $("post-title").value.trim();
    const content = $("post-content").value.trim();
    if (!title || !content) {
      alert("제목과 내용을 모두 입력해 주세요.");
      return;
    }
    const posts = getPosts();
    const newPost = {
      id: Date.now(),
      category,
      title,
      author,
      date: new Date().toISOString().slice(0, 10).replace(/-/g, "."),
      content,
    };
    posts.unshift(newPost);
    savePosts(posts);
    $("post-title").value = "";
    $("post-content").value = "";
    $("board-write-form").classList.remove("open");
    renderBoard();
    viewPost(newPost.id);
  });

  $("board-list-body").addEventListener("click", (e) => {
    const row = e.target.closest("tr[data-post-id]");
    if (!row) return;
    viewPost(Number(row.dataset.postId));
  });

  $("board-detail-view").addEventListener("click", (e) => {
    const btn = e.target.closest("#btn-delete-post");
    if (!btn) return;
    const id = Number(btn.dataset.postId);
    const author = btn.dataset.postAuthor;
    // 백엔드가 없어 진짜 로그인 인증은 불가능하지만, "아무나 바로 삭제" 되는 것은
    // 막기 위한 최소한의 안전장치로 작성자명 재확인을 요구합니다.
    const input = prompt(`삭제하려면 작성자명("${author}")을 그대로 입력하세요.`);
    if (input !== author) {
      if (input !== null) alert("작성자명이 일치하지 않아 삭제가 취소되었습니다.");
      return;
    }
    const posts = getPosts().filter((p) => p.id !== id);
    savePosts(posts);
    $("board-detail-view").classList.remove("open");
    renderBoard();
  });
}
