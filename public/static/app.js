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

        // KPI help button
        const kpiHelpBtn = document.getElementById('kpiHelpBtn');
        kpiHelpBtn?.addEventListener('click', this.showKPIHelp.bind(this));

        // Chart type switching
        window.switchChart = this.switchChart.bind(this);

        // Creative rankings global functions
        window.toggleCreativeDetail = this.toggleCreativeDetail.bind(this);
        window.exportToCSV = this.exportToCSV.bind(this);

        // CSV export button
        const exportBtn = document.getElementById('exportBtn');
        exportBtn?.addEventListener('click', this.exportToCSV.bind(this));

        // Tooltip functionality
        this.initializeTooltips();

        // Modal close functionality
        this.initializeModalListeners();
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
        
        // Update creative rankings
        this.updateCreativeRankings();
    }

    updateCreativeRankings() {
        const creativeRankings = document.getElementById('creativeRankings');
        
        if (!this.kpiData.campaigns || this.kpiData.campaigns.length === 0) {
            creativeRankings.innerHTML = `
                <div class="flex items-center justify-center py-8">
                    <div class="text-center">
                        <i class="fas fa-chart-line text-4xl text-gray-500 mb-4"></i>
                        <p>CSVをアップロードしてランキングを表示</p>
                    </div>
                </div>
            `;
            return;
        }

        // Calculate performance scores for each campaign
        const campaignsWithScores = this.kpiData.campaigns.map(campaign => {
            // Calculate individual scores (0-100 scale)
            const ctrScore = Math.min(100, Math.max(0, (campaign.ctr / 3.0) * 100)); // 3.0% = 100 points
            const followRateScore = Math.min(100, Math.max(0, (campaign.followRate / 2.0) * 100)); // 2.0% = 100 points
            const costEfficiencyScore = Math.min(100, Math.max(0, (200 - campaign.cpc) / 200 * 100)); // ¥200以下が良好
            
            // Calculate weighted total score
            const totalScore = (ctrScore * 0.4) + (followRateScore * 0.3) + (costEfficiencyScore * 0.3);
            
            return {
                ...campaign,
                ctrScore: Math.round(ctrScore),
                followRateScore: Math.round(followRateScore),
                costEfficiencyScore: Math.round(costEfficiencyScore),
                totalScore: Math.round(totalScore * 10) / 10 // 1decimal place
            };
        });

        // Sort by total score (highest first)
        campaignsWithScores.sort((a, b) => b.totalScore - a.totalScore);

        // Take top 5 campaigns
        const top5Campaigns = campaignsWithScores.slice(0, 5);

        let html = '';
        top5Campaigns.forEach((campaign, index) => {
            const rank = index + 1;
            const rankIcon = rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : `${rank}位`;
            const scoreColor = campaign.totalScore >= 80 ? 'text-green-400' : 
                              campaign.totalScore >= 60 ? 'text-yellow-400' : 'text-red-400';

            html += `
                <div class="creative-item bg-white/5 rounded-lg p-4 border border-white/10 hover:bg-white/10 transition-colors">
                    <div class="flex items-center justify-between cursor-pointer" onclick="toggleCreativeDetail('${index}')">
                        <div class="flex items-center space-x-3">
                            <span class="text-lg font-bold text-white">${rankIcon}</span>
                            <div>
                                <div class="font-semibold text-white">${campaign.name}</div>
                                <div class="text-xs text-gray-400">スコア: <span class="${scoreColor}">${campaign.totalScore}点</span></div>
                            </div>
                        </div>
                        <i class="fas fa-chevron-down text-gray-400 transition-transform duration-300" id="arrow-${index}"></i>
                    </div>
                    <div class="accordion-content mt-4" id="detail-${index}">
                        <div class="bg-white/5 rounded-lg p-4">
                            <div class="text-sm font-semibold text-white mb-3">
                                ▼ ${campaign.name} (スコア: ${campaign.totalScore}点) の内訳
                            </div>
                            <div class="overflow-x-auto">
                                <table class="w-full text-sm">
                                    <thead>
                                        <tr class="border-b border-gray-600">
                                            <th class="text-left py-2 text-gray-300">評価項目</th>
                                            <th class="text-left py-2 text-gray-300">生データ</th>
                                            <th class="text-left py-2 text-gray-300">スコア (100点満点換算)</th>
                                            <th class="text-left py-2 text-gray-300">最終スコアへの貢献度</th>
                                        </tr>
                                    </thead>
                                    <tbody class="text-gray-200">
                                        <tr>
                                            <td class="py-2 font-semibold">CTR (40%)</td>
                                            <td class="py-2">${campaign.ctr.toFixed(2)}%</td>
                                            <td class="py-2">${campaign.ctrScore}点</td>
                                            <td class="py-2 font-semibold text-purple-400">${(campaign.ctrScore * 0.4).toFixed(1)}点</td>
                                        </tr>
                                        <tr>
                                            <td class="py-2 font-semibold">フォロー率 (30%)</td>
                                            <td class="py-2">${campaign.followRate.toFixed(2)}%</td>
                                            <td class="py-2">${campaign.followRateScore}点</td>
                                            <td class="py-2 font-semibold text-blue-400">${(campaign.followRateScore * 0.3).toFixed(1)}点</td>
                                        </tr>
                                        <tr>
                                            <td class="py-2 font-semibold">コスト効率 (30%)</td>
                                            <td class="py-2">¥${Math.round(campaign.cpc)}</td>
                                            <td class="py-2">${campaign.costEfficiencyScore}点</td>
                                            <td class="py-2 font-semibold text-green-400">${(campaign.costEfficiencyScore * 0.3).toFixed(1)}点</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        });

        creativeRankings.innerHTML = html;
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
                            backgroundColor: 'rgba(255, 255, 255, 0.8)',
                            borderColor: 'white',
                            borderWidth: 2
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
                            backgroundColor: 'rgba(255, 255, 255, 0.8)',
                            borderColor: 'white',
                            borderWidth: 2
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
                            backgroundColor: 'rgba(255, 255, 255, 0.9)',
                            borderColor: 'white',
                            pointRadius: 8,
                            pointBorderWidth: 2
                        }]
                    },
                    options: {
                        ...this.getChartOptions('リーチ vs フォロー率'),
                        scales: {
                            x: {
                                title: {
                                    display: true,
                                    text: 'リーチ',
                                    color: 'white',
                                    font: { size: 14, weight: 'bold' }
                                },
                                ticks: { 
                                    color: 'white',
                                    font: { size: 12 }
                                },
                                grid: { 
                                    color: 'rgba(255, 255, 255, 0.2)',
                                    lineWidth: 1
                                },
                                border: {
                                    color: 'white'
                                }
                            },
                            y: {
                                title: {
                                    display: true,
                                    text: 'フォロー率 (%)',
                                    color: 'white',
                                    font: { size: 14, weight: 'bold' }
                                },
                                ticks: { 
                                    color: 'white',
                                    font: { size: 12 }
                                },
                                grid: { 
                                    color: 'rgba(255, 255, 255, 0.2)',
                                    lineWidth: 1
                                },
                                border: {
                                    color: 'white'
                                }
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
                    color: 'white',
                    font: { 
                        size: 18,
                        weight: 'bold'
                    }
                },
                legend: {
                    labels: { 
                        color: 'white',
                        font: { size: 14 }
                    }
                }
            },
            scales: {
                x: {
                    ticks: { 
                        color: 'white',
                        maxRotation: 45,
                        font: { size: 12 }
                    },
                    grid: { 
                        color: 'rgba(255, 255, 255, 0.2)',
                        lineWidth: 1
                    },
                    border: {
                        color: 'white'
                    }
                },
                y: {
                    ticks: { 
                        color: 'white',
                        font: { size: 12 }
                    },
                    grid: { 
                        color: 'rgba(255, 255, 255, 0.2)',
                        lineWidth: 1
                    },
                    border: {
                        color: 'white'
                    }
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

    initializeModalListeners() {
        // Close modal when clicking outside or on close button
        document.addEventListener('click', (event) => {
            const modal = document.getElementById('kpiModal');
            const modalContent = modal?.querySelector('.modal-content');
            
            if (modal && modal.classList.contains('active')) {
                // Close if clicking outside modal content or on close button
                if (!modalContent?.contains(event.target) || event.target.classList.contains('modal-close')) {
                    this.closeKPIModal();
                }
            }
        });

        // Close modal with escape key
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                this.closeKPIModal();
            }
        });
    }

    async showKPIHelp() {
        try {
            const response = await axios.get('/api/kpi-help');
            
            if (response.data) {
                this.displayKPIModal(response.data);
            }
        } catch (error) {
            console.error('KPI Help Error:', error);
            // Show fallback help even if API fails
            this.displayKPIModal(this.getFallbackKPIInfo());
        }
    }

    displayKPIModal(kpiInfo) {
        // Create modal if it doesn't exist
        let modal = document.getElementById('kpiModal');
        if (!modal) {
            modal = this.createKPIModal();
            document.body.appendChild(modal);
        }

        // Populate modal content
        const modalTitle = modal.querySelector('.modal-title');
        const modalBody = modal.querySelector('.modal-body');

        modalTitle.textContent = kpiInfo.title;

        let html = `<p class="text-gray-300 mb-6">${kpiInfo.description}</p>`;

        kpiInfo.metrics.forEach(metric => {
            html += `
                <div class="bg-white/5 rounded-lg p-4 mb-4 border border-white/10">
                    <h4 class="text-lg font-semibold text-white mb-2 flex items-center">
                        <i class="fas fa-chart-bar text-purple-400 mr-2"></i>
                        ${metric.name}
                        <span class="text-sm text-gray-400 ml-2">(${metric.japanese})</span>
                    </h4>
                    
                    <div class="text-gray-200 mb-3">
                        ${metric.definition}
                    </div>
                    
                    <div class="bg-white/5 rounded p-3 mb-3">
                        <div class="text-sm text-purple-300 font-mono">
                            <i class="fas fa-calculator mr-2"></i>
                            ${metric.formula}
                        </div>
                    </div>
                    
                    <div class="text-sm text-gray-300 mb-3">
                        <i class="fas fa-lightbulb text-yellow-400 mr-2"></i>
                        <strong>例：</strong> ${metric.example}
                    </div>
                    
                    ${metric.benchmark ? `
                        <div class="text-sm text-blue-300 mb-2">
                            <i class="fas fa-target text-blue-400 mr-2"></i>
                            <strong>ベンチマーク：</strong> ${metric.benchmark}
                        </div>
                    ` : ''}
                    
                    ${metric.improvementTips ? `
                        <div class="text-sm text-green-300">
                            <i class="fas fa-arrow-up text-green-400 mr-2"></i>
                            <strong>改善のヒント：</strong> ${metric.improvementTips}
                        </div>
                    ` : ''}
                </div>
            `;
        });

        modalBody.innerHTML = html;
        
        // Show modal
        modal.classList.add('active');
        document.body.style.overflow = 'hidden'; // Prevent background scrolling
    }

    createKPIModal() {
        const modal = document.createElement('div');
        modal.id = 'kpiModal';
        modal.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 opacity-0 invisible transition-all duration-300';
        
        modal.innerHTML = `
            <div class="modal-content bg-gradient-to-br from-purple-900/90 to-blue-900/90 backdrop-blur-md rounded-xl p-6 max-w-4xl max-h-[90vh] overflow-y-auto border border-white/20 shadow-2xl transform scale-95 transition-transform duration-300">
                <div class="flex justify-between items-center mb-6">
                    <h3 class="modal-title text-2xl font-bold text-white"></h3>
                    <button class="modal-close text-gray-400 hover:text-white transition-colors">
                        <i class="fas fa-times text-xl"></i>
                    </button>
                </div>
                <div class="modal-body"></div>
            </div>
        `;

        // Add CSS for active state
        const style = document.createElement('style');
        style.textContent = `
            #kpiModal.active {
                opacity: 1 !important;
                visibility: visible !important;
            }
            #kpiModal.active .modal-content {
                transform: scale(1) !important;
            }
        `;
        document.head.appendChild(style);

        return modal;
    }

    closeKPIModal() {
        const modal = document.getElementById('kpiModal');
        if (modal && modal.classList.contains('active')) {
            modal.classList.remove('active');
            document.body.style.overflow = ''; // Restore scrolling
        }
    }

    getFallbackKPIInfo() {
        return {
            title: 'KPI指標の説明',
            description: 'Meta広告分析で使用される主要指標の詳細解説',
            metrics: [
                {
                    name: 'CTR (Click Through Rate)',
                    japanese: 'クリック率',
                    definition: '広告が表示された回数に対して、実際にクリックされた割合を示す指標',
                    formula: 'CTR = (クリック数 ÷ インプレッション数) × 100',
                    example: '1,000回表示されて20回クリックされた場合、CTR = 2.0%',
                    benchmark: '一般的に1-3%が良好とされる',
                    improvementTips: 'クリエイティブの魅力向上、ターゲティングの最適化'
                },
                {
                    name: 'CPC (Cost Per Click)',
                    japanese: 'クリック単価',
                    definition: '1回のクリックを獲得するために要した平均コスト',
                    formula: 'CPC = 消化金額 ÷ クリック数',
                    example: '10,000円で50クリック獲得した場合、CPC = 200円',
                    benchmark: '業界により異なるが、50-500円程度',
                    improvementTips: '品質スコアの向上、入札戦略の最適化'
                },
                {
                    name: 'CPA (Cost Per Acquisition)',
                    japanese: 'フォロワー獲得単価',
                    definition: '1人のフォロワーを獲得するために要した平均コスト',
                    formula: 'CPA = 消化金額 ÷ フォロワー数',
                    example: '20,000円で100フォロワー獲得した場合、CPA = 200円',
                    benchmark: 'SNS広告では100-300円程度が目安',
                    improvementTips: 'ランディングページの最適化、オーディエンスの精度向上'
                },
                {
                    name: 'Follow Rate',
                    japanese: 'フォロー率',
                    definition: 'リーチした人数に対して、実際にフォローした人の割合',
                    formula: 'Follow Rate = (フォロワー数 ÷ リーチ数) × 100',
                    example: '10,000人にリーチして500人がフォローした場合、Follow Rate = 5.0%',
                    benchmark: '3-7%が良好な範囲',
                    improvementTips: 'アカウントの魅力度向上、コンテンツ品質の向上'
                }
            ]
        };
    }

    initializeTooltips() {
        const tooltipTrigger = document.getElementById('rankingTooltipTrigger');
        const tooltip = document.getElementById('rankingTooltip');
        
        if (tooltipTrigger && tooltip) {
            tooltipTrigger.addEventListener('mouseenter', () => {
                tooltip.classList.add('tooltip-show');
            });
            
            tooltipTrigger.addEventListener('mouseleave', () => {
                tooltip.classList.remove('tooltip-show');
            });
        }
    }

    toggleCreativeDetail(index) {
        const detailElement = document.getElementById(`detail-${index}`);
        const arrowElement = document.getElementById(`arrow-${index}`);
        
        if (detailElement && arrowElement) {
            const isExpanded = detailElement.classList.contains('expanded');
            
            if (isExpanded) {
                // Close
                detailElement.classList.remove('expanded');
                arrowElement.style.transform = 'rotate(0deg)';
            } else {
                // Close all other details first
                document.querySelectorAll('.accordion-content').forEach(el => {
                    el.classList.remove('expanded');
                });
                document.querySelectorAll('[id^="arrow-"]').forEach(el => {
                    el.style.transform = 'rotate(0deg)';
                });
                
                // Open this one
                detailElement.classList.add('expanded');
                arrowElement.style.transform = 'rotate(180deg)';
            }
        }
    }

    exportToCSV() {
        if (!this.kpiData || !this.kpiData.campaigns || this.kpiData.campaigns.length === 0) {
            alert('エクスポートするデータがありません。まずCSVをアップロードして分析を実行してください。');
            return;
        }

        try {
            // Calculate scores for all campaigns (same logic as updateCreativeRankings)
            const campaignsWithScores = this.kpiData.campaigns.map(campaign => {
                const ctrScore = Math.min(100, Math.max(0, (campaign.ctr / 3.0) * 100));
                const followRateScore = Math.min(100, Math.max(0, (campaign.followRate / 2.0) * 100));
                const costEfficiencyScore = Math.min(100, Math.max(0, (200 - campaign.cpc) / 200 * 100));
                const totalScore = (ctrScore * 0.4) + (followRateScore * 0.3) + (costEfficiencyScore * 0.3);
                
                return {
                    ...campaign,
                    ctrScore: Math.round(ctrScore),
                    followRateScore: Math.round(followRateScore),
                    costEfficiencyScore: Math.round(costEfficiencyScore),
                    totalScore: Math.round(totalScore * 10) / 10,
                    ctrContribution: Math.round(ctrScore * 0.4 * 10) / 10,
                    followRateContribution: Math.round(followRateScore * 0.3 * 10) / 10,
                    costEfficiencyContribution: Math.round(costEfficiencyScore * 0.3 * 10) / 10
                };
            });

            // Sort by total score
            campaignsWithScores.sort((a, b) => b.totalScore - a.totalScore);

            // Create CSV content
            const csvHeaders = [
                'ランキング',
                'キャンペーン名',
                '総合スコア',
                '消化金額',
                '結果数',
                'フォロワー数',
                'リーチ数',
                'インプレッション数',
                'CTR(%)',
                'CPC(円)',
                'CPA(円)',
                'フォロー率(%)',
                'CTRスコア(100点満点)',
                'フォロー率スコア(100点満点)',
                'コスト効率スコア(100点満点)',
                'CTR貢献度(40%)',
                'フォロー率貢献度(30%)',
                'コスト効率貢献度(30%)'
            ];

            let csvContent = csvHeaders.join(',') + '\n';

            campaignsWithScores.forEach((campaign, index) => {
                const rank = index + 1;
                const row = [
                    rank,
                    `"${campaign.name}"`,
                    campaign.totalScore,
                    Math.round(campaign.spend),
                    Math.round(campaign.results),
                    Math.round(campaign.followers),
                    Math.round(campaign.reach),
                    Math.round(campaign.impressions),
                    campaign.ctr.toFixed(2),
                    Math.round(campaign.cpc),
                    Math.round(campaign.cpa),
                    campaign.followRate.toFixed(2),
                    campaign.ctrScore,
                    campaign.followRateScore,
                    campaign.costEfficiencyScore,
                    campaign.ctrContribution,
                    campaign.followRateContribution,
                    campaign.costEfficiencyContribution
                ];
                csvContent += row.join(',') + '\n';
            });

            // Add summary statistics
            csvContent += '\n\n=== サマリー統計 ===\n';
            csvContent += `総キャンペーン数,${this.kpiData.totalCampaigns}\n`;
            csvContent += `総消化金額,${Math.round(this.kpiData.totalSpend)}\n`;
            csvContent += `総結果数,${Math.round(this.kpiData.totalResults)}\n`;
            csvContent += `総フォロワー獲得,${Math.round(this.kpiData.totalFollowers)}\n`;
            csvContent += `総リーチ,${Math.round(this.kpiData.totalReach)}\n`;
            csvContent += `総インプレッション,${Math.round(this.kpiData.totalImpressions)}\n`;
            csvContent += `平均CTR(%),${this.kpiData.avgCTR.toFixed(2)}\n`;
            csvContent += `平均CPC(円),${Math.round(this.kpiData.avgCPC)}\n`;
            csvContent += `平均CPA(円),${Math.round(this.kpiData.avgCPA)}\n`;
            csvContent += `平均フォロー率(%),${this.kpiData.avgFollowRate.toFixed(2)}\n`;

            // Add analysis timestamp
            csvContent += `\n分析実行日時,${new Date().toLocaleString('ja-JP')}\n`;

            // Create and download file
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            
            link.setAttribute('href', url);
            link.setAttribute('download', `AI広告分析結果_${new Date().toISOString().slice(0, 10)}.csv`);
            link.style.visibility = 'hidden';
            
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            // Show success message
            const exportStatus = document.getElementById('exportStatus');
            if (exportStatus) {
                exportStatus.textContent = '✅ CSVファイルをダウンロードしました';
                exportStatus.className = 'mt-2 text-sm text-green-300';
                
                setTimeout(() => {
                    exportStatus.textContent = '';
                }, 3000);
            }

        } catch (error) {
            console.error('CSV Export Error:', error);
            alert('CSVエクスポート中にエラーが発生しました。');
        }
    }
}

// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new AdAnalysisDashboard();
});