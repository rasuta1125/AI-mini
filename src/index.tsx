import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'

type Bindings = {
  OPENAI_API_KEY?: string;
}

const app = new Hono<{ Bindings: Bindings }>()

// Enable CORS for frontend-backend communication
app.use('/api/*', cors())

// Serve static files from public directory
app.use('/static/*', serveStatic({ root: './public' }))

// AI Analysis API Endpoint
app.post('/api/analyze', async (c) => {
  const { env } = c;
  
  if (!env.OPENAI_API_KEY) {
    return c.json({ error: 'OpenAI API key not configured' }, 500);
  }

  try {
    const { csvData } = await c.req.json();
    
    if (!csvData || !Array.isArray(csvData)) {
      return c.json({ error: 'Invalid CSV data' }, 400);
    }

    // Prepare data summary for OpenAI
    const summary = {
      totalCampaigns: csvData.length,
      totalSpend: csvData.reduce((sum, row) => sum + (parseFloat(row['消化金額']) || 0), 0),
      totalResults: csvData.reduce((sum, row) => sum + (parseFloat(row['結果']) || 0), 0),
      totalFollowers: csvData.reduce((sum, row) => sum + (parseFloat(row['フォロワー']) || 0), 0),
      totalReach: csvData.reduce((sum, row) => sum + (parseFloat(row['リーチ']) || 0), 0),
      totalImpressions: csvData.reduce((sum, row) => sum + (parseFloat(row['インプレッション']) || 0), 0),
      avgCTR: csvData.reduce((sum, row) => {
        const impressions = parseFloat(row['インプレッション']) || 0;
        const results = parseFloat(row['結果']) || 0;
        return sum + (impressions > 0 ? (results / impressions * 100) : 0);
      }, 0) / csvData.length,
      avgCPC: csvData.reduce((sum, row) => {
        const spend = parseFloat(row['消化金額']) || 0;
        const results = parseFloat(row['結果']) || 0;
        return sum + (results > 0 ? (spend / results) : 0);
      }, 0) / csvData.length,
      avgCPA: csvData.reduce((sum, row) => {
        const spend = parseFloat(row['消化金額']) || 0;
        const followers = parseFloat(row['フォロワー']) || 0;
        return sum + (followers > 0 ? (spend / followers) : 0);
      }, 0) / csvData.length,
      campaigns: csvData.slice(0, 5).map(row => ({
        name: row['キャンペーン名'] || row['広告セット名'] || 'Unknown',
        spend: parseFloat(row['消化金額']) || 0,
        results: parseFloat(row['結果']) || 0,
        followers: parseFloat(row['フォロワー']) || 0,
        reach: parseFloat(row['リーチ']) || 0,
        impressions: parseFloat(row['インプレッション']) || 0
      }))
    };

    const prompt = `
以下のMeta広告の分析データを基に、日本語で詳細な分析コメントを提供してください：

データサマリー:
- 総キャンペーン数: ${summary.totalCampaigns}
- 総消化金額: ¥${summary.totalSpend.toLocaleString()}
- 総結果数: ${summary.totalResults.toLocaleString()}
- 総フォロワー獲得: ${summary.totalFollowers.toLocaleString()}
- 総リーチ: ${summary.totalReach.toLocaleString()}
- 総インプレッション: ${summary.totalImpressions.toLocaleString()}
- 平均CTR: ${summary.avgCTR.toFixed(2)}%
- 平均CPC: ¥${summary.avgCPC.toFixed(0)}
- 平均CPA（フォロワー単価）: ¥${summary.avgCPA.toFixed(0)}

主要キャンペーン（上位5件）:
${summary.campaigns.map((c, i) => 
  `${i + 1}. ${c.name}: 消化¥${c.spend.toLocaleString()}, 結果${c.results}, フォロワー${c.followers}`
).join('\n')}

以下の形式で分析結果を提供してください：

## 良い点
[費用対効果が高いキャンペーンや良好な指標について具体的に記述]

## 改善が必要な点
[パフォーマンスが低いキャンペーンや課題について具体的に記述]

## 改善提案
[次回の運用で実践できる具体的な改善案を3-5個提示]
`;

    // Call OpenAI API
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'あなたは経験豊富なデジタルマーケティング専門家です。Meta広告のデータ分析に基づいて、具体的で実践的なアドバイスを提供してください。'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 1000,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const aiResult = await response.json();
    const analysisText = aiResult.choices[0]?.message?.content || 'AI分析の生成に失敗しました。';

    return c.json({
      success: true,
      analysis: analysisText,
      summary
    });

  } catch (error) {
    console.error('AI Analysis error:', error);
    return c.json({ 
      error: 'AI分析中にエラーが発生しました',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Health check endpoint
app.get('/api/health', (c) => {
  return c.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Default route - AI広告分析ダッシュボード
app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>AI広告分析ink | Meta広告データ分析ダッシュボード</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <style>
          /* Purple to Blue Gradient Background */
          .gradient-bg {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          }
          
          /* Glass Morphism Effects */
          .glass {
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.2);
          }
          
          .glass-card {
            background: rgba(255, 255, 255, 0.15);
            backdrop-filter: blur(15px);
            border: 1px solid rgba(255, 255, 255, 0.3);
            box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.37);
          }
          
          /* Hover Animations */
          .hover-scale {
            transition: transform 0.3s ease, box-shadow 0.3s ease;
          }
          
          .hover-scale:hover {
            transform: scale(1.02);
            box-shadow: 0 12px 40px 0 rgba(31, 38, 135, 0.5);
          }
          
          /* Button Gradient Animation */
          .btn-gradient {
            background: linear-gradient(45deg, #667eea, #764ba2);
            background-size: 200% 200%;
            animation: gradientShift 3s ease infinite;
          }
          
          @keyframes gradientShift {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
          }
          
          /* Loading Animation */
          .spinner {
            border: 4px solid rgba(255, 255, 255, 0.3);
            border-top: 4px solid #667eea;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
          }
          
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>
        <link href="/static/style.css" rel="stylesheet">
    </head>
    <body class="min-h-screen gradient-bg">
        <!-- Header -->
        <header class="glass border-b border-white/20">
            <div class="container mx-auto px-6 py-4">
                <div class="flex items-center justify-between">
                    <div class="flex items-center space-x-4">
                        <div class="w-10 h-10 bg-gradient-to-r from-purple-500 to-blue-500 rounded-lg flex items-center justify-center">
                            <i class="fas fa-chart-line text-white text-lg"></i>
                        </div>
                        <h1 class="text-2xl font-bold text-white">AI広告分析ink</h1>
                    </div>
                    <div class="flex space-x-2">
                        <span class="px-3 py-1 bg-purple-500/20 text-purple-200 rounded-full text-sm">CSV対応</span>
                        <span class="px-3 py-1 bg-blue-500/20 text-blue-200 rounded-full text-sm">AI分析</span>
                        <span class="px-3 py-1 bg-indigo-500/20 text-indigo-200 rounded-full text-sm">Cloudflare Pages</span>
                    </div>
                </div>
            </div>
        </header>

        <!-- Main Content -->
        <main class="container mx-auto px-6 py-8">
            <!-- Quick Start Section -->
            <section class="mb-12">
                <h2 class="text-3xl font-bold text-white text-center mb-8">クイックスタート（3ステップ）</h2>
                <div class="grid md:grid-cols-3 gap-6">
                    <div class="glass-card rounded-xl p-6 text-center hover-scale">
                        <div class="w-16 h-16 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center justify-center mx-auto mb-4">
                            <span class="text-white text-2xl font-bold">1</span>
                        </div>
                        <h3 class="text-xl font-semibold text-white mb-2">CSVを用意</h3>
                        <p class="text-gray-200">Metaからエクスポートした広告データのCSVファイルを準備します</p>
                    </div>
                    <div class="glass-card rounded-xl p-6 text-center hover-scale">
                        <div class="w-16 h-16 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full flex items-center justify-center mx-auto mb-4">
                            <span class="text-white text-2xl font-bold">2</span>
                        </div>
                        <h3 class="text-xl font-semibold text-white mb-2">アップロードして分析</h3>
                        <p class="text-gray-200">CSVをアップロードすると自動でKPIを算出・グラフ化します</p>
                    </div>
                    <div class="glass-card rounded-xl p-6 text-center hover-scale">
                        <div class="w-16 h-16 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full flex items-center justify-center mx-auto mb-4">
                            <span class="text-white text-2xl font-bold">3</span>
                        </div>
                        <h3 class="text-xl font-semibold text-white mb-2">AIコメントを確認</h3>
                        <p class="text-gray-200">AI分析による改善提案を確認し、次回の運用に反映します</p>
                    </div>
                </div>
            </section>

            <!-- 4 Card Layout -->
            <section class="grid lg:grid-cols-2 gap-8">
                <!-- Card 1: CSV Upload -->
                <div class="glass-card rounded-xl p-6 hover-scale">
                    <div class="flex items-center mb-6">
                        <i class="fas fa-file-csv text-purple-400 text-2xl mr-3"></i>
                        <h3 class="text-xl font-semibold text-white">CSVアップロード</h3>
                    </div>
                    <div class="mb-4">
                        <input type="file" id="csvFile" accept=".csv" class="w-full p-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-purple-500">
                    </div>
                    <button id="uploadBtn" class="w-full py-3 btn-gradient text-white rounded-lg font-semibold hover:shadow-lg transition-all duration-300">
                        <i class="fas fa-upload mr-2"></i>CSVを分析
                    </button>
                    <div id="csvStatus" class="mt-4 text-sm text-gray-300"></div>
                </div>

                <!-- Card 2: KPI Display -->
                <div class="glass-card rounded-xl p-6 hover-scale">
                    <div class="flex items-center mb-6">
                        <i class="fas fa-tachometer-alt text-blue-400 text-2xl mr-3"></i>
                        <h3 class="text-xl font-semibold text-white">主要KPI</h3>
                    </div>
                    <div id="kpiDisplay" class="grid grid-cols-2 gap-4">
                        <div class="text-center p-4 bg-white/5 rounded-lg">
                            <div class="text-2xl font-bold text-purple-400" id="ctrValue">-</div>
                            <div class="text-sm text-gray-300">平均CTR</div>
                        </div>
                        <div class="text-center p-4 bg-white/5 rounded-lg">
                            <div class="text-2xl font-bold text-blue-400" id="cpcValue">-</div>
                            <div class="text-sm text-gray-300">平均CPC</div>
                        </div>
                        <div class="text-center p-4 bg-white/5 rounded-lg">
                            <div class="text-2xl font-bold text-indigo-400" id="cpaValue">-</div>
                            <div class="text-sm text-gray-300">平均CPA</div>
                        </div>
                        <div class="text-center p-4 bg-white/5 rounded-lg">
                            <div class="text-2xl font-bold text-pink-400" id="followRateValue">-</div>
                            <div class="text-sm text-gray-300">フォロー率</div>
                        </div>
                    </div>
                </div>

                <!-- Card 3: Charts -->
                <div class="glass-card rounded-xl p-6 hover-scale">
                    <div class="flex items-center mb-6">
                        <i class="fas fa-chart-bar text-indigo-400 text-2xl mr-3"></i>
                        <h3 class="text-xl font-semibold text-white">グラフ分析</h3>
                    </div>
                    <div class="h-64">
                        <canvas id="performanceChart" class="w-full h-full"></canvas>
                    </div>
                    <div class="mt-4 flex justify-center space-x-2">
                        <button class="px-4 py-2 bg-purple-500/20 text-purple-200 rounded-lg text-sm hover:bg-purple-500/30 transition-colors" onclick="switchChart('ctr')">CTR比較</button>
                        <button class="px-4 py-2 bg-blue-500/20 text-blue-200 rounded-lg text-sm hover:bg-blue-500/30 transition-colors" onclick="switchChart('cpa')">CPA比較</button>
                        <button class="px-4 py-2 bg-indigo-500/20 text-indigo-200 rounded-lg text-sm hover:bg-indigo-500/30 transition-colors" onclick="switchChart('scatter')">散布図</button>
                    </div>
                </div>

                <!-- Card 4: AI Analysis -->
                <div class="glass-card rounded-xl p-6 hover-scale">
                    <div class="flex items-center justify-between mb-6">
                        <div class="flex items-center">
                            <i class="fas fa-robot text-pink-400 text-2xl mr-3"></i>
                            <h3 class="text-xl font-semibold text-white">AI分析コメント</h3>
                        </div>
                        <button id="analyzeBtn" class="px-4 py-2 btn-gradient text-white rounded-lg font-semibold hover:shadow-lg transition-all duration-300" disabled>
                            <i class="fas fa-magic mr-2"></i>AI分析実行
                        </button>
                    </div>
                    <div id="aiAnalysis" class="text-gray-300 space-y-4">
                        <div class="flex items-center justify-center py-8">
                            <div class="text-center">
                                <i class="fas fa-upload text-4xl text-gray-500 mb-4"></i>
                                <p>CSVをアップロードしてAI分析を開始</p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </main>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script src="/static/app.js"></script>
    </body>
    </html>
  `)
})

export default app