(function () {
  "use strict";

  window.ELTOwari.Registry.registerModule("ui-home-portal", function (app) {
    var esc = app.Utils.esc;
    var GRADE_LABELS = {
      "grade-5": "5. Sınıf", "grade-6": "6. Sınıf",
      "grade-7": "7. Sınıf", "grade-8": "8. Sınıf", "activities-hub": "ETKİNLİKLER"
    };

    function renderHeader() {
      var header = document.getElementById("app-header");
      if (!header) return;
      header.innerHTML =
        '<div class="brand-logo-group" id="hdr-brand-home" title="Ana Sayfaya Dön">' +
          '<svg class="brand-monogram"><use href="#svg-eo-logo"></use></svg>' +
          '<div class="brand-text-stack"><span class="brand-title">ELT OWARI</span><span class="brand-subtitle">by İlyas Owari</span></div>' +
        '</div>' +
        '<div class="header-right-controls">' +
          '<button type="button" class="header-icon-btn" id="hdr-search-btn" title="Hızlı Ara">🔍</button>' +
          '<button type="button" class="header-icon-btn" id="hdr-backup-btn" title="Portal Yedeği (.json)">💾</button>' +
          '<button type="button" class="header-icon-btn" id="hdr-fullscreen-btn" title="Tam Ekran">⛶</button>' +
          '<button type="button" class="teacher-avatar-btn" id="hdr-profile-btn" title="İlyas Owari — ELT Portalı"><svg><use href="#svg-teacher-avatar"></use></svg></button>' +
        '</div>';

      document.getElementById("hdr-brand-home").onclick = function () { navigate("HOME_BENTO"); };
      document.getElementById("hdr-search-btn").onclick = openQuickSearchModal;
      document.getElementById("hdr-backup-btn").onclick = openBackupModal;
      document.getElementById("hdr-profile-btn").onclick = function () { navigate("PROGRAMS_HUB"); };
      document.getElementById("hdr-fullscreen-btn").onclick = function () {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
        else document.exitFullscreen && document.exitFullscreen();
      };
    }

    function navigate(view, opts) {
      opts = opts || {};
      app.State.currentView = view;
      if (opts.gradeSection !== undefined) app.State.activeGradeSection = opts.gradeSection;
      if (opts.folderId !== undefined) app.State.currentFolderId = opts.folderId;
      if (opts.showTrash !== undefined) app.State.showTrash = opts.showTrash;
      document.body.className = view === "HOME_BENTO" ? "view-home" : "view-explorer";
      renderHeader();
      renderMain();
    }

    function renderMain() {
      var vp = document.getElementById("main-viewport");
      if (!vp) return;
      if (app.State.currentView === "HOME_BENTO") renderHomeBento(vp);
      else if (app.State.currentView === "PROGRAMS_HUB") renderProgramsHub(vp);
      else renderFolderExplorer(vp, app.State.currentView === "ACTIVITIES_HUB" ? "activities-hub" : app.State.activeGradeSection);
    }

    function renderHomeBento(vp) {
      var grades = [
        ["grade-5", "grade-card-5", "5. Sınıf"], ["grade-6", "grade-card-6", "6. Sınıf"],
        ["grade-7", "grade-card-7", "7. Sınıf"], ["grade-8", "grade-card-8", "8. Sınıf"]
      ];
      vp.innerHTML =
        '<section class="home-bento-stage">' +
          '<h1 class="home-section-heading">Bir Bölüm Seçin</h1>' +
          '<div class="cosmic-bento-grid">' +
            grades.map(function (g) {
              return '<div class="bento-grade-card ' + g[1] + '" data-grade-card="' + g[0] + '" role="button" tabindex="0">' +
                '<svg class="grade-rosette-svg" viewBox="0 0 120 120"><use href="#svg-rosette-8petal"></use></svg>' +
                '<div class="grade-card-title">' + g[2] + '</div><div class="card-pill-bar"></div></div>';
            }).join("") +
            '<div class="bento-wide-card" id="card-activities-hub" role="button" tabindex="0">' +
              '<h2 class="wide-card-heading">ETKİNLİKLER</h2>' +
              '<div class="wide-icon-row">' +
                '<svg class="wide-vector-svg" viewBox="0 0 84 64"><use href="#svg-act-gamepad"></use></svg>' +
                '<svg class="wide-vector-svg" viewBox="0 0 72 64"><use href="#svg-act-puzzle"></use></svg>' +
                '<svg class="wide-vector-svg" viewBox="0 0 72 64"><use href="#svg-act-trophy"></use></svg>' +
                '<svg class="wide-vector-svg" viewBox="0 0 68 64"><use href="#svg-act-star"></use></svg>' +
              '</div>' +
            '</div>' +
            '<div class="bento-wide-card" id="card-programs-hub" role="button" tabindex="0">' +
              '<h2 class="wide-card-heading">PROGRAMLAR</h2>' +
              '<div class="wide-icon-row">' +
                '<svg class="wide-vector-svg" viewBox="0 0 78 64"><use href="#svg-prog-monitor"></use></svg>' +
                '<svg class="wide-vector-svg" viewBox="0 0 64 64"><use href="#svg-prog-gear"></use></svg>' +
                '<svg class="wide-vector-svg" viewBox="0 0 76 64"><use href="#svg-prog-code"></use></svg>' +
                '<svg class="wide-vector-svg" viewBox="0 0 64 64"><use href="#svg-prog-chrome"></use></svg>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</section>';

      vp.querySelectorAll("[data-grade-card]").forEach(function (el) {
        el.onclick = function () {
          app.Audio && app.Audio.play("click");
          navigate("GRADE_EXPLORER", { gradeSection: el.getAttribute("data-grade-card"), folderId: "root", showTrash: false });
        };
      });
      document.getElementById("card-activities-hub").onclick = function () {
        app.Audio && app.Audio.play("click");
        navigate("ACTIVITIES_HUB", { gradeSection: "activities-hub", folderId: "root", showTrash: false });
      };
      document.getElementById("card-programs-hub").onclick = function () {
        app.Audio && app.Audio.play("click");
        navigate("PROGRAMS_HUB");
      };
    }

    function buildBreadcrumbs(sectionId, folderId, db) {
      var trail = [], cur = folderId;
      while (cur && cur !== "root") {
        var f = db.folders.find(function (x) { return x.id === cur; });
        if (!f) break;
        trail.unshift(f);
        cur = f.parentId;
      }
      var html = '<button type="button" class="breadcrumb-crumb" data-crumb="home">Ana Sayfa</button> › ' +
        '<button type="button" class="breadcrumb-crumb" data-crumb="root">' + esc(GRADE_LABELS[sectionId] || sectionId) + '</button>';
      trail.forEach(function (f) { html += ' › <button type="button" class="breadcrumb-crumb" data-crumb="' + esc(f.id) + '">' + esc(f.name) + '</button>'; });
      return html;
    }

    function sortItems(list, mode) {
      return list.slice().sort(function (a, b) {
        var an = (a.name || a.title || "").toLowerCase(), bn = (b.name || b.title || "").toLowerCase();
        if (mode === "NAME_DESC") return bn.localeCompare(an, "tr");
        if (mode === "CREATED_DESC") return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
        if (mode === "ACCESSED_DESC") return new Date(b.accessedAt || 0) - new Date(a.accessedAt || 0);
        return an.localeCompare(bn, "tr");
      });
    }

    function renderFolderExplorer(vp, sectionId) {
      var db = app.Storage.getDB();
      var q = (app.State.searchQuery || "").toLowerCase().trim();
      var showTrash = Boolean(app.State.showTrash);
      var folderId = app.State.currentFolderId || "root";
      var isHub = sectionId === "activities-hub";

      var folders = sortItems(db.folders.filter(function (f) {
        if (showTrash) return f.sectionId === sectionId && f.deleted;
        return f.sectionId === sectionId && !f.deleted && (q ? f.name.toLowerCase().indexOf(q) !== -1 : f.parentId === folderId);
      }), app.State.sortBy);

      var materials = sortItems(db.materials.filter(function (m) {
        if (showTrash) return (isHub || m.sectionId === sectionId) && m.deleted;
        var inSec = isHub ? (m.sectionId === "activities-hub" && (folderId === "root" || m.folderId === folderId)) : (m.sectionId === sectionId && (q || m.folderId === folderId));
        return !m.deleted && inSec && (!q || m.title.toLowerCase().indexOf(q) !== -1);
      }), app.State.sortBy);

      vp.innerHTML =
        '<section class="explorer-workspace">' +
          '<div class="explorer-toolbar">' +
            '<div class="explorer-left-nav"><button type="button" class="btn-glass" id="exp-back-home">← Ana Sayfaya Dön</button><div class="breadcrumb-bar">' + buildBreadcrumbs(sectionId, folderId, db) + '</div></div>' +
            '<div class="explorer-actions">' +
              '<input type="search" class="explorer-search" id="exp-search" placeholder="Ünite veya materyal ara..." value="' + esc(app.State.searchQuery) + '">' +
              '<select class="form-select" id="exp-sort" style="width:auto">' +
                '<option value="NAME_ASC"' + (app.State.sortBy === "NAME_ASC" ? " selected" : "") + '>Ada Göre (A-Z)</option>' +
                '<option value="NAME_DESC"' + (app.State.sortBy === "NAME_DESC" ? " selected" : "") + '>Ada Göre (Z-A)</option>' +
                '<option value="CREATED_DESC"' + (app.State.sortBy === "CREATED_DESC" ? " selected" : "") + '>Oluşturma Tarihi</option>' +
                '<option value="ACCESSED_DESC"' + (app.State.sortBy === "ACCESSED_DESC" ? " selected" : "") + '>Son Erişim</option>' +
              '</select>' +
              '<button type="button" class="btn-glass" id="exp-new-folder">+ Yeni Klasör</button>' +
              '<button type="button" class="btn-primary" id="exp-new-mat">+ Materyal / Etkinlik Ekle</button>' +
              '<button type="button" class="btn-glass ' + (showTrash ? "btn-danger" : "") + '" id="exp-trash-toggle">🗑️ ' + (showTrash ? "Klasöre Dön" : "Çöp Kutusu") + '</button>' +
            '</div>' +
          '</div>' +
          '<div class="explorer-grid" id="exp-grid"></div>' +
        '</section>';

      var html = "";
      if (folderId !== "root" && !showTrash) {
        html += '<div class="folder-card" data-exp-act="up-folder" style="cursor:pointer;justify-content:center;align-items:center">' +
          '<div style="font-size:28px">⬆️</div><strong>Üst Klasöre Çık</strong></div>';
      }

      folders.forEach(function (f) {
        html += '<div class="folder-card">' +
          '<div class="card-badge-row"><span style="font-size:28px">📁</span><span class="pill-tag">Ünite / Klasör</span></div>' +
          '<strong style="font-size:16px;cursor:pointer" data-exp-act="open-folder" data-id="' + esc(f.id) + '">' + esc(f.name) + '</strong>' +
          '<div class="card-meta-dates"><span>Oluşturma: ' + app.Utils.formatDate(f.createdAt) + '</span><span>Son Erişim: ' + app.Utils.formatDate(f.accessedAt) + '</span></div>' +
          '<div class="card-footer-btns">' +
            (showTrash
              ? '<button type="button" class="icon-mini-btn" data-exp-act="restore-folder" data-id="' + esc(f.id) + '">♻️ Geri Yükle</button><button type="button" class="icon-mini-btn btn-danger" data-exp-act="purge-folder" data-id="' + esc(f.id) + '">Kalıcı Sil</button>'
              : '<button type="button" class="btn-glass" style="padding:6px 12px;font-size:12px" data-exp-act="open-folder" data-id="' + esc(f.id) + '">Aç</button>' +
                '<div style="display:flex;gap:5px"><button type="button" class="icon-mini-btn" data-exp-act="rename-folder" data-id="' + esc(f.id) + '">✏️</button><button type="button" class="icon-mini-btn" data-exp-act="del-folder" data-id="' + esc(f.id) + '">🗑️</button></div>') +
          '</div></div>';
      });

      materials.forEach(function (m) {
        var actionBtn = m.fileData
          ? '<a class="btn-primary" style="text-decoration:none;padding:7px 14px;font-size:13px" download="' + esc(m.fileName || "materyal") + '" href="' + m.fileData + '">⬇ İndir</a>'
          : (m.url ? '<a class="btn-primary" style="text-decoration:none;padding:7px 14px;font-size:13px" target="_blank" rel="noopener" href="' + esc(m.url) + '">🚀 Aç / Başlat</a>' : '<span></span>');
        html += '<div class="material-card">' +
          '<div class="card-badge-row"><span style="font-size:24px">' + (m.kind.indexOf("HTML") !== -1 ? "🎮" : "📄") + '</span><span class="pill-tag">' + esc(m.kind) + '</span></div>' +
          '<strong style="font-size:16px">' + esc(m.title) + '</strong>' +
          '<p style="font-size:13px;color:#cbd5e1;line-height:1.45">' + esc(m.description) + '</p>' +
          '<div class="card-footer-btns">' +
            (showTrash
              ? '<button type="button" class="icon-mini-btn" data-exp-act="restore-mat" data-id="' + esc(m.id) + '">♻️ Geri Yükle</button><button type="button" class="icon-mini-btn btn-danger" data-exp-act="purge-mat" data-id="' + esc(m.id) + '">Kalıcı Sil</button>'
              : actionBtn + '<button type="button" class="icon-mini-btn" data-exp-act="del-mat" data-id="' + esc(m.id) + '">🗑️</button>') +
          '</div></div>';
      });

      document.getElementById("exp-grid").innerHTML = html || '<div class="folder-card" style="grid-column:1/-1;align-items:center;padding:36px"><span>Bu bölümde henüz materyal yok.</span></div>';
      bindExplorerEvents(sectionId, folderId);
    }

    function bindExplorerEvents(sectionId, folderId) {
      document.getElementById("exp-back-home").onclick = function () { navigate("HOME_BENTO"); };
      document.getElementById("exp-search").oninput = function (e) { app.State.searchQuery = e.target.value; renderMain(); };
      document.getElementById("exp-sort").onchange = function (e) { app.State.sortBy = e.target.value; renderMain(); };
      document.getElementById("exp-trash-toggle").onclick = function () { app.State.showTrash = !app.State.showTrash; renderMain(); };
      document.getElementById("exp-new-mat").onclick = function () { openAddMaterialModal(sectionId, folderId); };

      document.querySelectorAll("[data-crumb]").forEach(function (btn) {
        btn.onclick = function () {
          var c = btn.getAttribute("data-crumb");
          if (c === "home") return navigate("HOME_BENTO");
          app.State.currentFolderId = c; app.State.showTrash = false; renderMain();
        };
      });

      document.getElementById("exp-new-folder").onclick = function () {
        app.Utils.openModal(
          '<div class="modal-header"><h3 class="modal-title">Yeni Klasör Oluştur</h3><button type="button" class="modal-close-btn" id="m-cls">✕</button></div>' +
          '<div class="form-field"><label>Klasör Adı</label><input id="nf-name" class="form-input" placeholder="Örn: Unit 3 — Downtown"></div>' +
          '<div style="display:flex;justify-content:flex-end"><button type="button" class="btn-primary" id="nf-save">Oluştur</button></div>'
        );
        document.getElementById("m-cls").onclick = app.Utils.closeModal;
        document.getElementById("nf-save").onclick = function () {
          var name = (document.getElementById("nf-name").value || "").trim();
          if (!name) return;
          var db = app.Storage.getDB(), ts = new Date().toISOString();
          db.folders.push({ id: app.Utils.uid("fld"), sectionId: sectionId, parentId: folderId, name: name, createdAt: ts, accessedAt: ts, deleted: false });
          app.Storage.saveDB(db); app.Utils.closeModal(); renderMain();
        };
      };

      document.getElementById("exp-grid").onclick = function (e) {
        var btn = e.target.closest("[data-exp-act]");
        if (!btn) return;
        var actType = btn.getAttribute("data-exp-act"), id = btn.getAttribute("data-id"), db = app.Storage.getDB();
        if (actType === "up-folder") {
          var cur = db.folders.find(function (x) { return x.id === folderId; });
          app.State.currentFolderId = cur ? cur.parentId : "root"; return renderMain();
        }
        if (actType === "open-folder") {
          var f = db.folders.find(function (x) { return x.id === id; });
          if (f) { f.accessedAt = new Date().toISOString(); app.Storage.saveDB(db); }
          app.State.currentFolderId = id; return renderMain();
        }
        if (actType === "rename-folder") {
          var fr = db.folders.find(function (x) { return x.id === id; });
          var nx = fr && window.prompt("Klasör adını düzenle:", fr.name);
          if (nx && nx.trim()) { fr.name = nx.trim(); app.Storage.saveDB(db); renderMain(); }
        } else if (actType === "del-folder" || actType === "restore-folder") {
          var fd = db.folders.find(function (x) { return x.id === id; });
          if (fd) { fd.deleted = actType === "del-folder"; app.Storage.saveDB(db); renderMain(); }
        } else if (actType === "purge-folder") {
          db.folders = db.folders.filter(function (x) { return x.id !== id; }); app.Storage.saveDB(db); renderMain();
        } else if (actType === "del-mat" || actType === "restore-mat") {
          var mt = db.materials.find(function (x) { return x.id === id; });
          if (mt) { mt.deleted = actType === "del-mat"; app.Storage.saveDB(db); renderMain(); }
        } else if (actType === "purge-mat") {
          db.materials = db.materials.filter(function (x) { return x.id !== id; }); app.Storage.saveDB(db); renderMain();
        }
      };
    }

    function openAddMaterialModal(sectionId, folderId) {
      app.Utils.openModal(
        '<div class="modal-header"><h3 class="modal-title">+ Materyal / Tekil Etkinlik Ekle</h3><button type="button" class="modal-close-btn" id="mt-cls">✕</button></div>' +
        '<div class="form-field"><label>Başlık</label><input id="mt-title" class="form-input" placeholder="Örn: Unit 3 Çalışma Kağıdı"></div>' +
        '<div class="form-field"><label>Tür</label><select id="mt-kind" class="form-select"><option>PDF / Çalışma Kağıdı</option><option>Standalone HTML Etkinlik</option><option>Harici Bağlantı</option></select></div>' +
        '<div class="form-field"><label>Açıklama</label><textarea id="mt-desc" class="form-textarea" rows="2"></textarea></div>' +
        '<div class="form-field"><label>Bağlantı URL (Opsiyonel)</label><input id="mt-url" class="form-input" placeholder="https://... veya file:///..."></div>' +
        '<div class="form-field"><label>Dosya Yükle (PDF, HTML vb. — Opsiyonel)</label><input id="mt-file" type="file" class="form-input"></div>' +
        '<div style="display:flex;justify-content:flex-end"><button type="button" class="btn-primary" id="mt-save">Kaydet</button></div>'
      );
      document.getElementById("mt-cls").onclick = app.Utils.closeModal;
      var fData = "", fName = "";
      document.getElementById("mt-file").onchange = function (e) {
        var f = e.target.files[0]; if (!f) return; fName = f.name;
        var r = new FileReader(); r.onload = function (ev) { fData = ev.target.result; }; r.readAsDataURL(f);
      };
      document.getElementById("mt-save").onclick = function () {
        var title = document.getElementById("mt-title").value.trim(); if (!title) return;
        var db = app.Storage.getDB(), ts = new Date().toISOString();
        db.materials.unshift({
          id: app.Utils.uid("mat"), sectionId: sectionId, folderId: folderId, title: title,
          kind: document.getElementById("mt-kind").value, description: document.getElementById("mt-desc").value.trim(),
          url: document.getElementById("mt-url").value.trim(), fileName: fName, fileData: fData,
          createdAt: ts, accessedAt: ts, deleted: false
        });
        app.Storage.saveDB(db); app.Utils.closeModal(); renderMain();
      };
    }

    function renderProgramsHub(vp) {
      var db = app.Storage.getDB(), filter = app.State.programFilter || "ALL";
      var items = (db.programs || []).filter(function (p) {
        return filter === "ALL" || p.platform.indexOf(filter) !== -1;
      });
      vp.innerHTML =
        '<section class="explorer-workspace">' +
          '<div class="explorer-toolbar">' +
            '<div class="explorer-left-nav"><button type="button" class="btn-glass" id="prog-back-home">← Ana Sayfaya Dön</button><h2 style="font-size:20px;font-weight:800">PROGRAMLAR &amp; CHROME EKLENTİLERİ</h2></div>' +
            '<div class="explorer-actions">' +
              '<select class="form-select" id="prog-filter" style="width:auto">' +
                '<option value="ALL"' + (filter === "ALL" ? " selected" : "") + '>Tüm Platformlar</option>' +
                '<option value="Offline App"' + (filter === "Offline App" ? " selected" : "") + '>Offline Smartboard App</option>' +
                '<option value="Chrome Extension"' + (filter === "Chrome Extension" ? " selected" : "") + '>Chrome Extension</option>' +
                '<option value="Pardus Linux"' + (filter === "Pardus Linux" ? " selected" : "") + '>Pardus Linux</option>' +
                '<option value="Windows"' + (filter === "Windows" ? " selected" : "") + '>Windows</option>' +
              '</select>' +
              '<button type="button" class="btn-primary" id="prog-add-btn">+ Program / Eklenti Ekle</button>' +
            '</div>' +
          '</div>' +
          '<div class="explorer-grid">' +
            items.map(function (p) {
              var featCls = p.featured ? " featured-flagship" : "";
              return '<div class="program-card' + featCls + '">' +
                '<div class="card-badge-row">' +
                  '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
                    (p.featured ? '<span class="pill-tag flagship-badge">⭐ #1 ÖNE ÇIKAN UYGULAMA</span>' : '') +
                    '<span class="pill-tag">' + esc(p.platform) + '</span>' +
                  '</div>' +
                  '<span style="font-size:12px;color:#cbd5e1">v' + esc(p.version) + '</span>' +
                '</div>' +
                (p.screenshot ? '<img src="' + p.screenshot + '" alt="" style="width:100%;height:120px;object-fit:cover;border-radius:10px">' : '') +
                '<strong style="font-size:' + (p.featured ? "22px" : "17px") + '">' + esc(p.title) + '</strong>' +
                '<p style="font-size:13.5px;color:#e2e8f0;line-height:1.5">' + esc(p.description) + '</p>' +
                '<div class="card-footer-btns">' +
                  (p.fileData ? '<a class="btn-primary" style="text-decoration:none;padding:8px 14px;font-size:13px" download="' + esc(p.fileName || "package") + '" href="' + p.fileData + '">⬇ İndir</a>'
                    : (p.url ? '<a class="btn-primary" style="text-decoration:none;padding:8px 16px;font-size:13px" target="_blank" rel="noopener" href="' + esc(p.url) + '">' + (p.featured ? "🚀 Vocab Galaxy'yi Başlat / İncele" : "🔗 Bağlantıya Git") + '</a>' : '<span></span>')) +
                  (p.featured ? '' : '<button type="button" class="icon-mini-btn btn-danger" data-del-prog="' + esc(p.id) + '">🗑️</button>') +
                '</div></div>';
            }).join("") +
          '</div>' +
        '</section>';

      document.getElementById("prog-back-home").onclick = function () { navigate("HOME_BENTO"); };
      document.getElementById("prog-filter").onchange = function (e) { app.State.programFilter = e.target.value; renderProgramsHub(vp); };
      document.getElementById("prog-add-btn").onclick = openAddProgramModal;
      document.querySelectorAll("[data-del-prog]").forEach(function (btn) {
        btn.onclick = function () {
          var db2 = app.Storage.getDB(), pid = btn.getAttribute("data-del-prog");
          db2.programs = db2.programs.filter(function (x) { return x.id !== pid; });
          app.Storage.saveDB(db2); renderProgramsHub(vp);
        };
      });
    }

    function openAddProgramModal() {
      app.Utils.openModal(
        '<div class="modal-header"><h3 class="modal-title">Yeni Program / Eklenti Ekle</h3><button type="button" class="modal-close-btn" id="pm-cls">✕</button></div>' +
        '<div class="form-field"><label>Başlık</label><input id="pm-title" class="form-input"></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
          '<div class="form-field"><label>Sürüm</label><input id="pm-ver" class="form-input" value="1.0.0"></div>' +
          '<div class="form-field"><label>Platform</label><select id="pm-plat" class="form-select"><option>Chrome Extension</option><option>Pardus Linux</option><option>Windows</option><option>Windows &amp; Pardus Smartboard • Offline App</option></select></div>' +
        '</div>' +
        '<div class="form-field"><label>Açıklama</label><textarea id="pm-desc" class="form-textarea" rows="3"></textarea></div>' +
        '<div class="form-field"><label>Bağlantı URL</label><input id="pm-url" class="form-input" placeholder="https://..."></div>' +
        '<div style="display:flex;justify-content:flex-end"><button type="button" class="btn-primary" id="pm-save">Kaydet</button></div>'
      );
      document.getElementById("pm-cls").onclick = app.Utils.closeModal;
      document.getElementById("pm-save").onclick = function () {
        var title = document.getElementById("pm-title").value.trim(); if (!title) return;
        var db = app.Storage.getDB();
        db.programs.push({ id: app.Utils.uid("prog"), featured: false, title: title, version: document.getElementById("pm-ver").value.trim() || "1.0", platform: document.getElementById("pm-plat").value, description: document.getElementById("pm-desc").value.trim(), url: document.getElementById("pm-url").value.trim(), screenshot: "", fileName: "", fileData: "", createdAt: new Date().toISOString() });
        app.Storage.saveDB(db); app.Utils.closeModal(); renderMain();
      };
    }

    function openQuickSearchModal() {
      app.Utils.openModal(
        '<div class="modal-header"><h3 class="modal-title">🔍 Portalda Hızlı Ara</h3><button type="button" class="modal-close-btn" id="qs-cls">✕</button></div>' +
        '<input id="qs-input" class="form-input" placeholder="Ünite, materyal, etkinlik veya program adı yazın...">' +
        '<div id="qs-results" style="margin-top:14px;display:flex;flex-direction:column;gap:8px;max-height:340px;overflow-y:auto"></div>'
      );
      document.getElementById("qs-cls").onclick = app.Utils.closeModal;
      var inp = document.getElementById("qs-input"), resEl = document.getElementById("qs-results");
      function update() {
        var q = inp.value.toLowerCase().trim(), db = app.Storage.getDB(), rows = [];
        db.folders.filter(function (f) { return !f.deleted && (!q || f.name.toLowerCase().indexOf(q) !== -1); }).slice(0, 6).forEach(function (f) {
          rows.push('<button type="button" class="btn-glass" style="justify-content:flex-start" data-qs-fld="' + esc(f.id) + '" data-qs-sec="' + esc(f.sectionId) + '">📁 ' + esc(f.name) + '</button>');
        });
        db.materials.filter(function (m) { return !m.deleted && (!q || m.title.toLowerCase().indexOf(q) !== -1); }).slice(0, 6).forEach(function (m) {
          rows.push('<button type="button" class="btn-glass" style="justify-content:flex-start" data-qs-fld="' + esc(m.folderId) + '" data-qs-sec="' + esc(m.sectionId) + '">📄 ' + esc(m.title) + '</button>');
        });
        db.programs.filter(function (p) { return !q || p.title.toLowerCase().indexOf(q) !== -1; }).forEach(function (p) {
          rows.push('<button type="button" class="btn-glass" style="justify-content:flex-start" data-qs-prog="1">💻 ' + esc(p.title) + '</button>');
        });
        resEl.innerHTML = rows.join("") || '<span style="color:#94a3b8">Sonuç bulunamadı.</span>';
      }
      inp.oninput = update;
      resEl.onclick = function (e) {
        var b = e.target.closest("button"); if (!b) return;
        app.Utils.closeModal();
        if (b.getAttribute("data-qs-prog")) return navigate("PROGRAMS_HUB");
        var sec = b.getAttribute("data-qs-sec"), fld = b.getAttribute("data-qs-fld");
        navigate(sec === "activities-hub" ? "ACTIVITIES_HUB" : "GRADE_EXPLORER", { gradeSection: sec, folderId: fld || "root" });
      };
      update();
    }

    function openBackupModal() {
      app.Utils.openModal(
        '<div class="modal-header"><h3 class="modal-title">💾 Portal Yedekleme &amp; Geri Yükleme</h3><button type="button" class="modal-close-btn" id="bk-cls">✕</button></div>' +
        '<p style="color:#cbd5e1;font-size:14px;margin-bottom:16px">Tüm ünite klasörlerini, materyalleri ve program vitrinini tek bir .json dosyasında yedekleyin veya geri yükleyin.</p>' +
        '<div style="display:flex;flex-wrap:wrap;gap:12px">' +
          '<button type="button" class="btn-primary" id="bk-export">⬇ Portal Yedeği İndir (.json)</button>' +
          '<label class="btn-glass" style="cursor:pointer">⬆ Yedekten Geri Yükle (.json)<input type="file" id="bk-import" accept=".json" style="display:none"></label>' +
        '</div>'
      );
      document.getElementById("bk-cls").onclick = app.Utils.closeModal;
      document.getElementById("bk-export").onclick = app.Storage.exportPortalBackup;
      document.getElementById("bk-import").onchange = function (e) {
        if (e.target.files[0]) app.Storage.importPortalBackup(e.target.files[0], function () { app.Utils.closeModal(); renderMain(); });
      };
    }

    app.HomePortal = { renderHeader: renderHeader, renderMain: renderMain, navigate: navigate };
    document.addEventListener("DOMContentLoaded", function () { renderHeader(); renderMain(); });
  });
})();
