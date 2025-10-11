// AI広告分析ink - Frontend JavaScript
class AdAnalysisDashboard {
    constructor() {
        this.csvData = [];
        this.kpiData = {};
        this.chart = null;
        this.currentChartType = 'ctr';
        
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        // CSV file input
        const csvFile = document.getElementById('csvFile');
        const uploadBtn = document.getElementById('uploadBtn');
        const analyzeBtn = document.getElementById('analyzeBtn');

        csvFile?.addEventListener('change', this.handleFileSelect.bind(this));
        uploadBtn?.addEventListener('click', this.uploadAndAnalyzeCSV.bind(this));
        analyzeBtn?.addEventListener('click', this.performAIAnalysis.bind(this));

        // Chart type switching
        window.switchChart = this.switchChart.bind(this);
    }

    handleFileSelect(event) {
        const file = event.target.files[0];
        const status = document.getElementById('csvStatus');
        
        if (file) {
            if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
                status.textContent = `✓ ファイル選択済み: ${file.name} (${(file.size / 1024).toFixed(1)}KB)`;
                status.className = 'mt-4 text-sm text-green-300';
            } else {
                status.textContent = '⚠ CSVファイルを選択してください';
                status.className = 'mt-4 text-sm text-red-300';
            }
        }
    }

    async uploadAndAnalyzeCSV() {
        const fileInput = document.getElementById('csvFile');
        const file = fileInput.files[0];
        const status = document.getElementById('csvStatus');
        
        if (!file) {
            status.textContent = '⚠ CSVファイルを選択してください';
            status.className = 'mt-4 text-sm text-red-300';
            return;
        }

        try {
            status.textContent = '📊 CSVを解析中...';
            status.className = 'mt-4 text-sm text-yellow-300';

            const csvText = await this.readFileAsText(file);
            this.csvData = this.parseCSV(csvText);
            
            if (this.csvData.length === 0) {
                throw new Error('CSVデータが空です');
            }

            // Calculate KPIs
            this.kpiData = this.calculateKPIs(this.csvData);
            
            // Update UI
            this.updateKPIDisplay();
            this.createChart();
            
            // Enable AI analysis button
            document.getElementById('analyzeBtn').disabled = false;
            
            status.textContent = `✅ 分析完了: ${this.csvData.length}キャンペーンを処理しました`;
            status.className = 'mt-4 text-sm text-green-300';
            
        } catch (error) {
            console.error('CSV Upload Error:', error);
            status.textContent = `❌ エラー: ${error.message}`;
            status.className = 'mt-4 text-sm text-red-300';
        }
    }

    readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (e) => reject(new Error('ファイル読み込みエラー'));
            reader.readAsText(file, 'UTF-8');
        });
    }

    parseCSV(csvText) {
        // Remove BOM if present
        csvText = csvText.replace(/^\ufeff/, '');
        
        console.log('Raw CSV text (first 500 chars):', csvText.substring(0, 500));
        
        // Split lines and filter out empty ones
        const lines = csvText.split(/\r?\n/).filter(line => line.trim());
        console.log('CSV lines found:', lines.length);
        
        if (lines.length < 2) {
            throw new Error(`CSVファイルが無効です（ヘッダーとデータが必要）。検出された行数: ${lines.length}`);
        }

        // Parse header line
        const rawHeaders = this.parseCSVLine(lines[0]);
        console.log('Raw headers:', rawHeaders);
        
        // Clean and map headers to expected names
        const headers = rawHeaders.map(h => h.trim());
        console.log('Cleaned headers:', headers);
        
        // Create column mapping for Japanese headers
        const columnMapping = this.createColumnMapping(headers);
        console.log('Column mapping:', columnMapping);
        
        const data = [];

        // Parse data lines
        for (let i = 1; i < lines.length; i++) {
            const values = this.parseCSVLine(lines[i]);
            if (values.length > 0 && values.some(v => v.trim())) { // Skip completely empty rows
                const row = {};
                
                // Map columns to standardized names
                headers.forEach((header, index) => {
                    const standardName = columnMapping[header] || header;
                    row[standardName] = values[index] || '';
                });
                
                // Ensure we have at least some required data
                if (row['キャンペーン名'] || row['広告セット名'] || row['消化金額']) {
                    data.push(row);
                }
            }
        }

        console.log('Parsed CSV data (first 3 rows):', data.slice(0, 3));
        console.log('Total rows parsed:', data.length);
        
        if (data.length === 0) {
            throw new Error('CSVファイルにデータが見つかりません。ヘッダー行以外にデータ行があることを確認してください。');
        }
        
        return data;
    }

    createColumnMapping(headers) {
        const mapping = {};
        
        headers.forEach(header => {
            const cleanHeader = header.trim();
            
            // Map various possible column names to standardized names
            if (cleanHeader.includes('キャンペーン名') || cleanHeader === 'Campaign Name') {
                mapping[cleanHeader] = 'キャンペーン名';
            } else if (cleanHeader.includes('広告セット名') || cleanHeader === 'Ad Set Name') {
                mapping[cleanHeader] = '広告セット名';
            } else if (cleanHeader.includes('消化金額') || cleanHeader.includes('Amount Spent') || cleanHeader.includes('JPY')) {
                mapping[cleanHeader] = '消化金額';
            } else if (cleanHeader.includes('結果') && !cleanHeader.includes('単価') && !cleanHeader.includes('タイプ')) {
                mapping[cleanHeader] = '結果';
            } else if (cleanHeader.includes('フォロワー') || cleanHeader === 'Followers') {
                mapping[cleanHeader] = 'フォロワー';
            } else if (cleanHeader.includes('リーチ') || cleanHeader === 'Reach') {
                mapping[cleanHeader] = 'リーチ';
            } else if (cleanHeader.includes('インプレッション') || cleanHeader === 'Impressions') {
                mapping[cleanHeader] = 'インプレッション';
            } else {
                // Keep original name if no mapping found
                mapping[cleanHeader] = cleanHeader;
            }
        });
        
        return mapping;
    }

    parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const nextChar = line[i + 1];

            if (char === '"') {
                if (inQuotes && nextChar === '"') {
                    // Escaped quote
                    current += '"';
                    i++; // Skip next quote
                } else {
                    // Toggle quote state
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }

        result.push(current.trim());
        return result.map(value => value.replace(/^"|"$/g, '')); // Remove surrounding quotes only
    }

    calculateKPIs(data) {
        const kpis = {
            totalCampaigns: data.length,
            totalSpend: 0,
            totalResults: 0,
            totalFollowers: 0,
            totalReach: 0,
            totalImpressions: 0,
            campaigns: []
        };

        data.forEach(row => {
            const spend = this.parseNumber(row['消化金額']);
            const results = this.parseNumber(row['結果']);
            const followers = this.parseNumber(row['フォロワー']);
            const reach = this.parseNumber(row['リーチ']);
            const impressions = this.parseNumber(row['インプレッション']);

            kpis.totalSpend += spend;
            kpis.totalResults += results;
            kpis.totalFollowers += followers;
            kpis.totalReach += reach;
            kpis.totalImpressions += impressions;

            // Calculate per-campaign metrics
            const ctr = impressions > 0 ? (results / impressions * 100) : 0;
            const cpc = results > 0 ? (spend / results) : 0;
            const cpa = followers > 0 ? (spend / followers) : 0;
            const followRate = reach > 0 ? (followers / reach * 100) : 0;

            kpis.campaigns.push({
                name: row['キャンペーン名'] || row['広告セット名'] || `Campaign ${kpis.campaigns.length + 1}`,
                spend,
                results,
                followers,
                reach,
                impressions,
                ctr,
                cpc,
                cpa,
                followRate
            });
        });

        // Calculate averages
        kpis.avgCTR = kpis.totalImpressions > 0 ? (kpis.totalResults / kpis.totalImpressions * 100) : 0;
        kpis.avgCPC = kpis.totalResults > 0 ? (kpis.totalSpend / kpis.totalResults) : 0;
        kpis.avgCPA = kpis.totalFollowers > 0 ? (kpis.totalSpend / kpis.totalFollowers) : 0;
        kpis.avgFollowRate = kpis.totalReach > 0 ? (kpis.totalFollowers / kpis.totalReach * 100) : 0;

        return kpis;
    }

    parseNumber(value) {
        if (!value || value === '') return 0;
        
        if (typeof value === 'string') {
            // Remove currency symbols, commas, whitespace, and parentheses
            value = value.replace(/[¥,\\s()]/g, '');
            // Handle negative numbers in parentheses format
            if (value.includes('-')) {
                value = value.replace('-', '');
                return -parseFloat(value) || 0;
            }
        }
        const num = parseFloat(value);
        return isNaN(num) ? 0 : num;
    }

    updateKPIDisplay() {
        document.getElementById('ctrValue').textContent = `${this.kpiData.avgCTR.toFixed(2)}%`;
        document.getElementById('cpcValue').textContent = `¥${Math.round(this.kpiData.avgCPC).toLocaleString()}`;
        document.getElementById('cpaValue').textContent = `¥${Math.round(this.kpiData.avgCPA).toLocaleString()}`;
        document.getElementById('followRateValue').textContent = `${this.kpiData.avgFollowRate.toFixed(2)}%`;
    }

    createChart() {
        const canvas = document.getElementById('performanceChart');
        const ctx = canvas.getContext('2d');

        // Destroy existing chart
        if (this.chart) {
            this.chart.destroy();
        }

        this.switchChart(this.currentChartType);
    }

    switchChart(type) {
        this.currentChartType = type;
        const canvas = document.getElementById('performanceChart');
        const ctx = canvas.getContext('2d');

        // Destroy existing chart
        if (this.chart) {
            this.chart.destroy();
        }

        const topCampaigns = this.kpiData.campaigns
            .sort((a, b) => b.spend - a.spend)
            .slice(0, 10);

        let chartConfig;

        switch (type) {
            case 'ctr':
                chartConfig = {
                    type: 'bar',
                    data: {
                        labels: topCampaigns.map(c => this.truncateText(c.name, 20)),
                        datasets: [{
                            label: 'CTR (%)',
                            data: topCampaigns.map(c => c.ctr),
                            backgroundColor: 'rgba(102, 126, 234, 0.6)',
                            borderColor: 'rgba(102, 126, 234, 1)',
                            borderWidth: 1
                        }]
                    },
                    options: this.getChartOptions('CTR比較 (%)')
                };
                break;

            case 'cpa':
                chartConfig = {
                    type: 'bar',
                    data: {
                        labels: topCampaigns.map(c => this.truncateText(c.name, 20)),
                        datasets: [{
                            label: 'CPA (¥)',
                            data: topCampaigns.map(c => c.cpa),
                            backgroundColor: 'rgba(118, 75, 162, 0.6)',
                            borderColor: 'rgba(118, 75, 162, 1)',
                            borderWidth: 1
                        }]
                    },
                    options: this.getChartOptions('CPA比較 (¥)')
                };
                break;

            case 'scatter':
                chartConfig = {
                    type: 'scatter',
                    data: {
                        datasets: [{
                            label: 'リーチ vs フォロー率',
                            data: topCampaigns.map(c => ({
                                x: c.reach,
                                y: c.followRate
                            })),
                            backgroundColor: 'rgba(102, 126, 234, 0.6)',
                            borderColor: 'rgba(102, 126, 234, 1)',
                            pointRadius: 6
                        }]
                    },
                    options: {
                        ...this.getChartOptions('リーチ vs フォロー率'),
                        scales: {
                            x: {
                                title: {
                                    display: true,
                                    text: 'リーチ',
                                    color: 'rgba(255, 255, 255, 0.8)'
                                },
                                ticks: { color: 'rgba(255, 255, 255, 0.8)' },
                                grid: { color: 'rgba(255, 255, 255, 0.1)' }
                            },
                            y: {
                                title: {
                                    display: true,
                                    text: 'フォロー率 (%)',
                                    color: 'rgba(255, 255, 255, 0.8)'
                                },
                                ticks: { color: 'rgba(255, 255, 255, 0.8)' },
                                grid: { color: 'rgba(255, 255, 255, 0.1)' }
                            }
                        }
                    }
                };
                break;
        }

        this.chart = new Chart(ctx, chartConfig);
    }

    getChartOptions(title) {
        return {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: title,
                    color: 'rgba(255, 255, 255, 0.9)',
                    font: { size: 16 }
                },
                legend: {
                    labels: { color: 'rgba(255, 255, 255, 0.8)' }
                }
            },
            scales: {
                x: {
                    ticks: { 
                        color: 'rgba(255, 255, 255, 0.8)',
                        maxRotation: 45
                    },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' }
                },
                y: {
                    ticks: { color: 'rgba(255, 255, 255, 0.8)' },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' }
                }
            }
        };
    }

    truncateText(text, maxLength) {
        return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
    }

    async performAIAnalysis() {
        const analyzeBtn = document.getElementById('analyzeBtn');
        const aiAnalysis = document.getElementById('aiAnalysis');

        try {
            // Show loading state
            analyzeBtn.disabled = true;
            analyzeBtn.innerHTML = '<div class="spinner mx-auto"></div>';
            
            aiAnalysis.innerHTML = `
                <div class="flex items-center justify-center py-8">
                    <div class="text-center">
                        <div class="spinner mx-auto mb-4"></div>
                        <p>AI分析を実行中...</p>
                        <p class="text-sm text-gray-400 mt-2">OpenAIが広告データを分析しています</p>
                    </div>
                </div>
            `;

            const response = await axios.post('/api/analyze', {
                csvData: this.csvData
            }, {
                timeout: 30000 // 30 second timeout
            });

            if (response.data.success) {
                this.displayAIAnalysis(response.data.analysis);
            } else {
                throw new Error(response.data.error || 'AI分析に失敗しました');
            }

        } catch (error) {
            console.error('AI Analysis Error:', error);
            
            let errorMessage = 'AI分析中にエラーが発生しました。';
            if (error.code === 'ECONNABORTED') {
                errorMessage = 'AI分析がタイムアウトしました。再度お試しください。';
            } else if (error.response?.status === 500) {
                errorMessage = 'サーバーエラーが発生しました。OpenAI APIキーの設定を確認してください。';
            }
            
            aiAnalysis.innerHTML = `
                <div class="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
                    <div class="flex items-center text-red-400 mb-2">
                        <i class="fas fa-exclamation-triangle mr-2"></i>
                        <span class="font-semibold">AI分析エラー</span>
                    </div>
                    <p class="text-red-300">${errorMessage}</p>
                    <p class="text-xs text-red-400 mt-2">${error.message}</p>
                </div>
            `;
        } finally {
            // Reset button state
            analyzeBtn.disabled = false;
            analyzeBtn.innerHTML = '<i class="fas fa-magic mr-2"></i>AI分析実行';
        }
    }

    displayAIAnalysis(analysisText) {
        const aiAnalysis = document.getElementById('aiAnalysis');
        
        // Parse the analysis text for better formatting
        const sections = this.parseAnalysisText(analysisText);
        
        let html = '';
        
        sections.forEach(section => {
            html += `
                <div class="mb-6">
                    <h4 class="text-lg font-semibold text-white mb-3 flex items-center">
                        ${this.getSectionIcon(section.title)}
                        ${section.title}
                    </h4>
                    <div class="bg-white/5 rounded-lg p-4">
                        <div class="text-gray-200 whitespace-pre-line">${section.content}</div>
                    </div>
                </div>
            `;
        });

        // Add timestamp
        html += `
            <div class="text-xs text-gray-400 text-center mt-4">
                分析実行日時: ${new Date().toLocaleString('ja-JP')}
            </div>
        `;

        aiAnalysis.innerHTML = html;
    }

    parseAnalysisText(text) {
        const sections = [];
        const lines = text.split('\n').filter(line => line.trim());
        
        let currentSection = null;
        
        lines.forEach(line => {
            line = line.trim();
            
            // Check if this line is a section header (starts with ##)
            if (line.startsWith('##')) {
                if (currentSection) {
                    sections.push(currentSection);
                }
                currentSection = {
                    title: line.replace(/^##\s*/, ''),
                    content: ''
                };
            } else if (currentSection && line) {
                currentSection.content += line + '\n';
            }
        });
        
        // Add the last section
        if (currentSection) {
            sections.push(currentSection);
        }
        
        // If no sections were found, create a default section
        if (sections.length === 0) {
            sections.push({
                title: 'AI分析結果',
                content: text
            });
        }
        
        return sections;
    }

    getSectionIcon(title) {
        if (title.includes('良い') || title.includes('Good')) {
            return '<i class="fas fa-check-circle text-green-400 mr-2"></i>';
        } else if (title.includes('改善') || title.includes('問題') || title.includes('課題')) {
            return '<i class="fas fa-exclamation-circle text-yellow-400 mr-2"></i>';
        } else if (title.includes('提案') || title.includes('推奨')) {
            return '<i class="fas fa-lightbulb text-blue-400 mr-2"></i>';
        }
        return '<i class="fas fa-chart-line text-purple-400 mr-2"></i>';
    }
}

// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new AdAnalysisDashboard();
});