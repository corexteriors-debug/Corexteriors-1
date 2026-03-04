const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

/**
 * Google Sheets integration for London Lead Finder
 * Syncs lead data to Google Sheets automatically
 */

class GoogleSheetsSync {
  constructor() {
    this.sheets = null;
    this.auth = null;
    this.initialized = false;
  }

  /**
   * Initialize Google Sheets API client
   * Uses service account credentials from .env
   */
  async initialize() {
    try {
      const credentialsPath = process.env.GOOGLE_SHEETS_CREDENTIALS;
      
      if (!credentialsPath) {
        console.log('ℹ️  Google Sheets not configured (GOOGLE_SHEETS_CREDENTIALS not set)');
        return false;
      }

      const fullPath = path.resolve(credentialsPath);
      
      if (!fs.existsSync(fullPath)) {
        console.log(`⚠️  Credentials file not found: ${fullPath}`);
        return false;
      }

      const credentials = JSON.parse(fs.readFileSync(fullPath, 'utf8'));

      this.auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      this.sheets = google.sheets({ version: 'v4', auth: this.auth });
      this.initialized = true;
      console.log('✓ Google Sheets API initialized');
      return true;
    } catch (error) {
      console.error('Failed to initialize Google Sheets:', error.message);
      return false;
    }
  }

  /**
   * Check if Google Sheets is configured and ready
   */
  isReady() {
    return this.initialized && !!process.env.GOOGLE_SHEET_ID;
  }

  /**
   * Get the configured spreadsheet ID
   */
  getSpreadsheetId() {
    return process.env.GOOGLE_SHEET_ID;
  }

  /**
   * Test connection to a specific Google Sheet
   */
  async testConnection(spreadsheetId = null) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.initialized) {
      throw new Error('Google Sheets API not initialized');
    }

    const sheetId = spreadsheetId || this.getSpreadsheetId();
    
    if (!sheetId) {
      throw new Error('No spreadsheet ID provided');
    }

    try {
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId: sheetId,
      });
      
      return {
        success: true,
        title: response.data.properties.title,
        spreadsheetId: sheetId,
      };
    } catch (error) {
      throw new Error(`Cannot access spreadsheet: ${error.message}`);
    }
  }

  /**
   * Sync all leads to Google Sheet
   * Clears existing data and writes fresh data
   */
  async syncToSheet(places, spreadsheetId = null) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.initialized) {
      throw new Error('Google Sheets API not initialized');
    }

    const sheetId = spreadsheetId || this.getSpreadsheetId();
    
    if (!sheetId) {
      throw new Error('No spreadsheet ID configured');
    }

    try {
      // Prepare data
      const headers = [
        'Name',
        'Address',
        'Phone',
        'Email',
        'Website',
        'Type',
        'Replied',
        'Notes',
        'Last Updated',
      ];

      const rows = places.map((place) => [
        place.name || '',
        place.address || '',
        place.phone || '',
        place.email || '',
        place.website || '',
        this.formatType(place.type) || '',
        place.replied || '',
        place.notes || '',
        new Date().toISOString(),
      ]);

      const values = [headers, ...rows];

      // Clear existing data
      await this.sheets.spreadsheets.values.clear({
        spreadsheetId: sheetId,
        range: 'Sheet1',
      });

      // Write new data
      const result = await this.sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: 'Sheet1!A1',
        valueInputOption: 'RAW',
        resource: { values },
      });

      // Format the header row
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        resource: {
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId: 0,
                  startRowIndex: 0,
                  endRowIndex: 1,
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.2, green: 0.3, blue: 0.5 },
                    textFormat: {
                      foregroundColor: { red: 1, green: 1, blue: 1 },
                      bold: true,
                    },
                  },
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat)',
              },
            },
            {
              autoResizeDimensions: {
                dimensions: {
                  sheetId: 0,
                  dimension: 'COLUMNS',
                  startIndex: 0,
                  endIndex: headers.length,
                },
              },
            },
          ],
        },
      });

      return {
        success: true,
        rowsWritten: rows.length,
        spreadsheetId: sheetId,
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      throw new Error(`Failed to sync to Google Sheets: ${error.message}`);
    }
  }

  /**
   * Append new leads to existing sheet without clearing
   */
  async appendToSheet(places, spreadsheetId = null) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.initialized) {
      throw new Error('Google Sheets API not initialized');
    }

    const sheetId = spreadsheetId || this.getSpreadsheetId();
    
    if (!sheetId) {
      throw new Error('No spreadsheet ID configured');
    }

    try {
      const rows = places.map((place) => [
        place.name || '',
        place.address || '',
        place.phone || '',
        place.email || '',
        place.website || '',
        this.formatType(place.type) || '',
        place.replied || '',
        place.notes || '',
        new Date().toISOString(),
      ]);

      const result = await this.sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: 'Sheet1!A:I',
        valueInputOption: 'RAW',
        resource: { values: rows },
      });

      return {
        success: true,
        rowsAdded: rows.length,
        spreadsheetId: sheetId,
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      throw new Error(`Failed to append to Google Sheets: ${error.message}`);
    }
  }

  /**
   * Format building type for display
   */
  formatType(type) {
    if (!type) return 'Unknown';
    return type.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  }
}

// Export singleton instance
module.exports = new GoogleSheetsSync();
