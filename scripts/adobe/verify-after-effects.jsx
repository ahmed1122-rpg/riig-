(function verifyAfterEffectsGolden() {
  var scriptFile = new File($.fileName);
  var root = scriptFile.parent.parent.parent;
  var generated = new Folder(
    root.fsName + "/artifacts/adobe-golden/generated",
  );
  var reportFile = new File(
    root.fsName + "/artifacts/adobe-golden/after-effects-result.txt",
  );
  var cases = [
    {
      filename: "image-layers.psd",
      width: 640,
      height: 360,
      layers: ["+البطاقة", "+الخلفية"],
    },
    {
      filename: "book-pages.psd",
      width: 640,
      height: 720,
      layers: ["+page_001", "+page_002"],
    },
  ];
  var lines = [
    "APP|Adobe After Effects|" + app.version,
    "OS|" + $.os.replace(/\s+$/, ""),
  ];
  var initialItemIds = {};
  var project = app.project || app.newProject();
  var initialItemCount = project.numItems;
  var failures = [];

  for (var existingIndex = 1; existingIndex <= project.numItems; existingIndex += 1) {
    initialItemIds[project.item(existingIndex).id] = true;
  }

  app.beginUndoGroup("Verify MotionPrep Adobe Golden");
  try {
    for (var caseIndex = 0; caseIndex < cases.length; caseIndex += 1) {
      inspectCase(cases[caseIndex], caseIndex);
    }
  } catch (error) {
    failures.push("Unexpected After Effects error: " + error.toString());
  } finally {
    removeImportedItems();
    lines.push("CLEANUP|" + initialItemCount + "|" + project.numItems);
    check(
      project.numItems === initialItemCount,
      "Imported After Effects items were not fully cleaned up.",
    );
    app.endUndoGroup();
  }

  for (var failureIndex = 0; failureIndex < failures.length; failureIndex += 1) {
    lines.push("FAIL|" + failures[failureIndex]);
  }
  lines.push(failures.length === 0 ? "RESULT|PASS" : "RESULT|FAIL");

  reportFile.encoding = "UTF-8";
  if (!reportFile.open("w")) {
    app.exitCode = 3;
    throw new Error("Cannot write After Effects Golden report.");
  }
  reportFile.write(lines.join("\n") + "\n");
  reportFile.close();
  app.exitCode = failures.length === 0 ? 0 : 2;

  function inspectCase(testCase, caseIndex) {
    var inputFile = new File(generated.fsName + "/" + testCase.filename);
    var options = new ImportOptions(inputFile);
    var canRetain = options.canImportAs(ImportAsType.COMP_CROPPED_LAYERS);
    check(canRetain, testCase.filename + " cannot retain layer sizes.");
    options.importAs = ImportAsType.COMP_CROPPED_LAYERS;
    var imported = project.importFile(options);
    var composition = imported instanceof CompItem ? imported : null;
    check(composition !== null, testCase.filename + " did not import as a composition.");
    if (composition === null) return;

    lines.push(
      [
        "FILE",
        testCase.filename,
        canRetain,
        composition.width,
        composition.height,
        composition.numLayers,
      ].join("|"),
    );
    check(
      composition.width === testCase.width &&
        composition.height === testCase.height,
      testCase.filename + " composition dimensions drifted.",
    );
    check(
      composition.numLayers === testCase.layers.length,
      testCase.filename + " composition layer count drifted.",
    );
    var previewFile = new File(
      generated.fsName + "/after-effects-" + caseIndex + ".png",
    );
    if (typeof composition.saveFrameToPng === "function") {
      var originalResolutionFactor = composition.resolutionFactor;
      composition.resolutionFactor = [1, 1];
      try {
        composition.saveFrameToPng(0, previewFile);
      } finally {
        composition.resolutionFactor = originalResolutionFactor;
      }
      lines.push(
        "PREVIEW|" +
          testCase.filename +
          "|artifacts/adobe-golden/generated/after-effects-" +
          caseIndex +
          ".png",
      );
    } else {
      failures.push("After Effects cannot render a PNG preview for " + testCase.filename + ".");
    }

    for (var layerIndex = 1; layerIndex <= composition.numLayers; layerIndex += 1) {
      var layer = composition.layer(layerIndex);
      var source = layer.source;
      var opacity = layer
        .property("ADBE Transform Group")
        .property("ADBE Opacity").value;
      var alphaMode = "n/a";
      if (source && source.mainSource && source.mainSource.alphaMode !== undefined) {
        alphaMode = source.mainSource.alphaMode.toString();
      }
      lines.push(
        [
          "LAYER",
          caseIndex,
          layerIndex,
          layer.name,
          source ? source.width : "n/a",
          source ? source.height : "n/a",
          opacity,
          layer.enabled,
          alphaMode,
        ].join("|"),
      );
      check(
        layer.name === testCase.layers[layerIndex - 1],
        testCase.filename + " layer order drifted at " + layerIndex + ".",
      );
    }

    if (testCase.filename === "image-layers.psd" && composition.numLayers >= 2) {
      var cardOpacity = composition
        .layer(1)
        .property("ADBE Transform Group")
        .property("ADBE Opacity").value;
      check(
        Math.abs(cardOpacity - 72) < 0.05,
        "image-layers.psd card opacity is not 72%.",
      );
    }
  }

  function check(condition, message) {
    if (!condition) failures.push(message);
  }

  function removeImportedItems() {
    var regularItems = [];
    var folders = [];
    for (var itemIndex = 1; itemIndex <= project.numItems; itemIndex += 1) {
      var item = project.item(itemIndex);
      if (!initialItemIds[item.id]) {
        if (item instanceof FolderItem) folders.push(item);
        else regularItems.push(item);
      }
    }
    for (var regularIndex = regularItems.length - 1; regularIndex >= 0; regularIndex -= 1) {
      try { regularItems[regularIndex].remove(); } catch (_) {}
    }
    for (var folderIndex = folders.length - 1; folderIndex >= 0; folderIndex -= 1) {
      try { folders[folderIndex].remove(); } catch (_) {}
    }
  }
}());
