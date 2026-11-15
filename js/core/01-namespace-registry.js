(function () {
  "use strict";

  var isoNow = new Date().toISOString();

  var SEED_FOLDERS = [
    { id: "fld-5-u1", sectionId: "grade-5", parentId: "root", name: "Unit 1 — Hello!", createdAt: isoNow, accessedAt: isoNow, deleted: false },
    { id: "fld-5-u2", sectionId: "grade-5", parentId: "root", name: "Unit 2 — My Town", createdAt: isoNow, accessedAt: isoNow, deleted: false },
    { id: "fld-6-u1", sectionId: "grade-6", parentId: "root", name: "Unit 1 — Life", createdAt: isoNow, accessedAt: isoNow, deleted: false },
    { id: "fld-6-u2", sectionId: "grade-6", parentId: "root", name: "Unit 2 — Yummy Breakfast", createdAt: isoNow, accessedAt: isoNow, deleted: false },
    { id: "fld-7-u1", sectionId: "grade-7", parentId: "root", name: "Unit 1 — Appearance & Personality", createdAt: isoNow, accessedAt: isoNow, deleted: false },
    { id: "fld-8-u1", sectionId: "grade-8", parentId: "root", name: "Unit 1 — Friendship", createdAt: isoNow, accessedAt: isoNow, deleted: false },
    { id: "fld-act-vocab", sectionId: "activities-hub", parentId: "root", name: "Vocabulary & Matching Archive", createdAt: isoNow, accessedAt: isoNow, deleted: false },
    { id: "fld-act-grammar", sectionId: "activities-hub", parentId: "root", name: "Grammar & Sentence Quizzes", createdAt: isoNow, accessedAt: isoNow, deleted: false },
    { id: "fld-act-reading", sectionId: "activities-hub", parentId: "root", name: "Reading & Cloze Worksheets", createdAt: isoNow, accessedAt: isoNow, deleted: false }
  ];

  var SEED_MATERIALS = [
    {
      id: "mat-5-town", sectionId: "grade-5", folderId: "fld-5-u2",
      title: "Unit 2 — Places in My Town (Çalışma Kağıdı & Kartlar)",
      kind: "PDF / Çalışma Kağıdı",
      description: "5. sınıf My Town ünitesi görsel kelime listesi ve sınıf içi eşleştirme çalışma kağıdı.",
      url: "https://ilyasowari.pages.dev", fileName: "", fileData: "",
      createdAt: isoNow, accessedAt: isoNow, deleted: false
    },
    {
      id: "mat-6-breakfast", sectionId: "grade-6", folderId: "fld-6-u2",
      title: "Unit 2 — Yummy Breakfast (İnteraktif HTML Etkinlik)",
      kind: "Standalone HTML Etkinlik",
      description: "Akıllı tahtada tarayıcıdan doğrudan açılabilen çevrimdışı kahvaltı kelimeleri etkinliği.",
      url: "file:///D:/Owari%20Apps/Vocab%20Galaxy/index.html", fileName: "", fileData: "",
      createdAt: isoNow, accessedAt: isoNow, deleted: false
    },
    {
      id: "mat-6-life", sectionId: "grade-6", folderId: "fld-6-u1",
      title: "Unit 1 — Daily Routines & Telling Time Özeti",
      kind: "PDF / Ders Notu",
      description: "Simple Present Tense ve saatler konu özeti ile alıştırma yaprakları.",
      url: "https://ilyasowari.pages.dev", fileName: "", fileData: "",
      createdAt: isoNow, accessedAt: isoNow, deleted: false
    },
    {
      id: "mat-7-person", sectionId: "grade-7", folderId: "fld-7-u1",
      title: "Unit 1 — Appearance vs Personality Sıfat Kartları",
      kind: "PDF / Çalışma Kağıdı",
      description: "Fiziksel görünüm ve kişilik sıfatlarını karşılaştıran sınıf materyali.",
      url: "https://ilyasowari.pages.dev", fileName: "", fileData: "",
      createdAt: isoNow, accessedAt: isoNow, deleted: false
    },
    {
      id: "mat-8-friend", sectionId: "grade-8", folderId: "fld-8-u1",
      title: "Unit 1 — Friendship LGS Deneme & Davetiye Kalıpları",
      kind: "Standalone HTML Etkinlik",
      description: "LGS İngilizce 1. ünite kabul-red kalıpları ve cümle tamamlama arşivi.",
      url: "file:///D:/Owari%20Apps/Vocab%20Galaxy/index.html", fileName: "", fileData: "",
      createdAt: isoNow, accessedAt: isoNow, deleted: false
    },
    {
      id: "mat-act-vocab1", sectionId: "activities-hub", folderId: "fld-act-vocab",
      title: "5–8. Sınıflar Ortak Kelime Eşleştirme Paketi",
      kind: "İnteraktif Etkinlik",
      description: "Vocab Galaxy ile hazırlanan hazır akıllı tahta kelime ve görsel eşleştirme setleri.",
      url: "file:///D:/Owari%20Apps/Vocab%20Galaxy/index.html", fileName: "", fileData: "",
      createdAt: isoNow, accessedAt: isoNow, deleted: false
    },
    {
      id: "mat-act-gram1", sectionId: "activities-hub", folderId: "fld-act-grammar",
      title: "Tenses & Modal Verbs Quiz Arşivi",
      kind: "İnteraktif Quiz",
      description: "Sınıf içi hızlı tekrar ve yarışma formatında hazırlanmış çoktan seçmeli etkinlikler.",
      url: "file:///D:/Owari%20Apps/Vocab%20Galaxy/index.html", fileName: "", fileData: "",
      createdAt: isoNow, accessedAt: isoNow, deleted: false
    }
  ];

  var SEED_PROGRAMS = [
    {
      id: "prog-vocab-galaxy",
      featured: true,
      title: "Vocab Galaxy (by İlyas Owari)",
      version: "1.0.0",
      platform: "Windows & Pardus Smartboard • Offline App",
      description: "Öğrenci yoklaması, kırmızı çerçeveli isim listesi, doğum günü kutlaması, Gemini AI etkinlik üreticisi, tam ekran öğrenci Spotlight şovu, çift sütunlu liderlik tablosu, 6 görsel tema, 15 oyun motoru, tekil HTML dışa aktarma ve A4 PDF çalışma kağıdı motorunu içeren bağımsız sınıf oyun stüdyosu.",
      url: "file:///D:/Owari%20Apps/Vocab%20Galaxy/index.html",
      fileName: "",
      fileData: "",
      createdAt: isoNow
    },
    {
      id: "prog-1",
      featured: false,
      title: "OWARI Vocab Clipper",
      version: "1.4.2",
      platform: "Chrome Extension",
      description: "İngilizce metinlerden tek tıkla kelime kartı ve sesli telaffuz listesi çıkaran tarayıcı eklentisi.",
      url: "https://ilyasowari.pages.dev",
      fileName: "",
      fileData: "",
      createdAt: isoNow
    },
    {
      id: "prog-2",
      featured: false,
      title: "ETAP Akıllı Tahta Kısayol Çubuğu",
      version: "2.1.0",
      platform: "Pardus Linux",
      description: "Pardus ETAP akıllı tahtalarda ders esnasında kronometre, yazı tahtası ve hızlı ekran kalemi sunar.",
      url: "https://ilyasowari.pages.dev",
      fileName: "",
      fileData: "",
      createdAt: isoNow
    },
    {
      id: "prog-3",
      featured: false,
      title: "ELT Worksheet Studio Desktop",
      version: "1.0.8",
      platform: "Windows",
      description: "İnternetsiz ortamda toplu kelime bulmacası ve çalışma kağıdı oluşturan taşınabilir masaüstü aracı.",
      url: "https://ilyasowari.pages.dev",
      fileName: "",
      fileData: "",
      createdAt: isoNow
    }
  ];

  window.ELTOwari = {
    version: "2.1.0-portal",
    Registry: {
      modules: {},
      registerModule: function (id, initFn) {
        this.modules[id] = initFn;
        try { initFn(window.ELTOwari); } catch (err) { console.error("Module init error:", id, err); }
      }
    },
    State: {
      currentView: "HOME_BENTO", // "HOME_BENTO" | "GRADE_EXPLORER" | "ACTIVITIES_HUB" | "PROGRAMS_HUB"
      activeGradeSection: null,
      currentFolderId: "root",
      showTrash: false,
      searchQuery: "",
      sortBy: "NAME_ASC",
      programFilter: "ALL",
      settings: { soundVolume: 0.7, muted: false }
    },
    SeedData: {
      folders: SEED_FOLDERS,
      materials: SEED_MATERIALS,
      programs: SEED_PROGRAMS
    },
    Utils: {
      uid: function (prefix) { return (prefix || "id") + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6); },
      esc: function (str) {
        return String(str == null ? "" : str)
          .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      },
      formatDate: function (iso) {
        if (!iso) return "-";
        var d = new Date(iso);
        return isNaN(d.getTime()) ? "-" : d.toLocaleDateString("tr-TR") + " " + d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
      },
      toast: function (msg) {
        var box = document.getElementById("elt-toast-container");
        if (!box) {
          box = document.createElement("div");
          box.id = "elt-toast-container";
          box.className = "toast-container";
          document.body.appendChild(box);
        }
        var item = document.createElement("div");
        item.className = "toast-item";
        item.textContent = msg;
        box.appendChild(item);
        setTimeout(function () { if (item.parentNode) item.parentNode.removeChild(item); }, 3000);
      },
      openModal: function (html) {
        var root = document.getElementById("modal-root");
        root.innerHTML = '<div class="modal-backdrop" id="active-modal-backdrop"><div class="modal-card">' + html + "</div></div>";
        var bd = document.getElementById("active-modal-backdrop");
        bd.addEventListener("click", function (e) { if (e.target === bd) window.ELTOwari.Utils.closeModal(); });
      },
      closeModal: function () {
        var root = document.getElementById("modal-root");
        if (root) root.innerHTML = "";
      }
    }
  };
})();
