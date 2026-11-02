/**
 * ============================================================================
 * MedHelix — Google Sheets Waitlist Integration (Counting from 0)
 * ============================================================================
 *
 * Sheet: https://docs.google.com/spreadsheets/d/1pKpk6upY_OXBJpgQCNIwsm84JooGyFGmrEsWOQGwEhw/edit
 *
 * SETUP INSTRUCTIONS (Takes ~1 minute):
 * 1. Open your Google Sheet in your browser.
 * 2. In the top menu, click: Extensions > Apps Script
 * 3. Delete any default code in the editor, and paste this entire code block.
 * 4. Click the blue "Deploy" button (top right) > "New deployment".
 * 5. Click the gear icon next to "Select type" and select "Web app".
 * 6. Set Description: "MedHelix Waitlist"
 * 7. Set "Execute as": "Me" (your Google account)
 * 8. Set "Who has access": "Anyone"
 * 9. Click "Deploy".
 * 10. Click "Authorize access", sign in, click "Advanced" > "Go to Untitled project (unsafe)", and click "Allow".
 * 11. Copy the "Web app URL" (starts with https://script.google.com/macros/s/...)
 * 12. Paste the Web app URL into server.js (GOOGLE_SCRIPT_URL) or send it here!
 */

function doGet(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const lastRow = sheet.getLastRow();
  
  // Real count of users (excluding header row)
  const count = Math.max(0, lastRow > 0 ? lastRow - 1 : 0);

  const output = JSON.stringify({
    success: true,
    count: count,
    totalSignups: count
  });

  return ContentService.createTextOutput(output)
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

    // Auto-create header row if empty
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["Timestamp", "Email", "Role", "Source", "Position", "Code"]);
      sheet.getRange(1, 1, 1, 6).setFontWeight("bold");
      sheet.setFrozenRows(1);
    }

    let data = {};
    if (e && e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    } else if (e && e.parameter) {
      data = e.parameter;
    }

    const email = String(data.email || "").trim();
    const role = String(data.role || "Student").trim();
    const source = String(data.source || "hero").trim();
    const timestamp = Utilities.formatDate(new Date(), "GMT", "yyyy-MM-dd'T'HH:mm:ss'Z'");

    // Count starts from 0; first user is position #1
    const currentUsers = Math.max(0, sheet.getLastRow() - 1);
    const position = currentUsers + 1;
    
    // Generate clean referral code: MHLX-XXXXX
    const rawHash = Utilities.base64Encode(
      Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, email + position)
    ).replace(/[^a-zA-Z0-9]/g, "").substring(0, 5).toUpperCase();
    const code = "MHLX-" + rawHash;

    sheet.appendRow([timestamp, email, role, source, position, code]);

    const count = position;

    const response = JSON.stringify({
      success: true,
      position: position,
      count: count,
      code: code
    });

    return ContentService.createTextOutput(response)
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    const errorResponse = JSON.stringify({
      success: false,
      error: error.toString()
    });
    return ContentService.createTextOutput(errorResponse)
      .setMimeType(ContentService.MimeType.JSON);
  }
}
