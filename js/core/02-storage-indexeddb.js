(function () {
  "use strict";

  window.ELTOwari.Registry.registerModule("core-storage", function (app) {
    var LS_PORTAL_KEY = "ELTOwari_Portal_v2";
    var IDB_NAME = "ELTOwariPortalDB";
    var IDB_STORE = "kvstore";
    var dbCache = null;

    function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

    function openIDB(cb) {
      if (!window.indexedDB) return cb(null);
      try {
        var req = window.indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
        };
        req.onsuccess = function (e) { cb(e.target.result); };
        req.onerror = function () { cb(null); };
      } catch (err) { cb(null); }
    }

    function syncToIDB(payload) {
      openIDB(function (db) {
        if (!db) return;
        try {
          var tx = db.transaction(IDB_STORE, "readwrite");
          tx.objectStore(IDB_STORE).put(payload, "portal");
        } catch (err) {}
      });
    }

    function loadInitialDB() {
      if (dbCache) return dbCache;
      try {
        var raw = localStorage.getItem(LS_PORTAL_KEY);
        if (raw) dbCache = JSON.parse(raw);
      } catch (err) {}
      if (!dbCache) {
        dbCache = {
          folders: clone(app.SeedData.folders),
          materials: clone(app.SeedData.materials),
          programs: clone(app.SeedData.programs),
          syncedSeeds: app.SeedData.programs.map(function (p) { return p.id; })
        };
        saveDB(dbCache);
      } else {
        var dirty = false;
        if (!Array.isArray(dbCache.syncedSeeds)) { dbCache.syncedSeeds = []; dirty = true; }
        if (!Array.isArray(dbCache.programs)) { dbCache.programs = []; dirty = true; }
        app.SeedData.programs.forEach(function (sp) {
          if (dbCache.syncedSeeds.indexOf(sp.id) === -1) {
            var exists = dbCache.programs.some(function (p) { return p.id === sp.id; });
            if (!exists) {
              if (dbCache.programs.length > 0 && dbCache.programs[0].id === "prog-vocab-galaxy") {
                dbCache.programs.splice(1, 0, clone(sp));
              } else {
                dbCache.programs.push(clone(sp));
              }
            }
            dbCache.syncedSeeds.push(sp.id);
            dirty = true;
          }
        });
        if (dirty) saveDB(dbCache);
      }
      return dbCache;
    }

    function saveDB(nextDb) {
      if (nextDb) dbCache = nextDb;
      try { localStorage.setItem(LS_PORTAL_KEY, JSON.stringify(dbCache)); } catch (err) {}
      syncToIDB(dbCache);
    }

    function compressImage(fileOrBlob, maxDim, cb) {
      var reader = new FileReader();
      reader.onload = function (ev) {
        var img = new Image();
        img.onload = function () {
          var scale = Math.min(1, (maxDim || 480) / Math.max(img.width, img.height));
          var canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          cb(canvas.toDataURL("image/jpeg", 0.8));
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(fileOrBlob);
    }

    function exportPortalBackup() {
      var bundle = { app: "ELTOwariPortal", version: app.version, exportedAt: new Date().toISOString(), data: loadInitialDB() };
      var blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "ELTOwari_Portal_Yedek_" + new Date().toISOString().slice(0, 10) + ".json";
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      app.Utils.toast("Portal yedeği (.json) indirildi.");
    }

    function importPortalBackup(file, onDone) {
      var reader = new FileReader();
      reader.onload = function (ev) {
        try {
          var parsed = JSON.parse(ev.target.result);
          if (!parsed || !parsed.data || !Array.isArray(parsed.data.folders)) throw new Error("Geçersiz portal yedek dosyası.");
          dbCache = parsed.data;
          saveDB(dbCache);
          app.Utils.toast("Portal yedeği geri yüklendi!");
          if (onDone) onDone();
        } catch (err) { app.Utils.toast("Yedek yüklenemedi: " + err.message); }
      };
      reader.readAsText(file);
    }

    app.Storage = {
      getDB: loadInitialDB, saveDB: saveDB, compressImage: compressImage,
      exportPortalBackup: exportPortalBackup, importPortalBackup: importPortalBackup
    };

    loadInitialDB();
  });
})();
