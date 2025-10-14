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

    // Call OpenAI API with retry logic
    let response;
    let retryCount = 0;
    const maxRetries = 3;

    while (retryCount < maxRetries) {
      try {
        response = await fetch('https://api.openai.com/v1/chat/completions', {
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
            max_tokens: 800,
            temperature: 0.7
          })
        });

        if (response.ok) {
          break; // Success, exit retry loop
        }

        // Handle rate limiting (429) with exponential backoff
        if (response.status === 429) {
          retryCount++;
          if (retryCount < maxRetries) {
            const waitTime = Math.pow(2, retryCount) * 1000; // 2s, 4s, 8s
            console.log(`Rate limited. Waiting ${waitTime}ms before retry ${retryCount}/${maxRetries}`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
        }

        // Handle other errors
        const errorText = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);

      } catch (fetchError) {
        retryCount++;
        if (retryCount >= maxRetries) {
          throw fetchError;
        }
        // Wait before retry for network errors
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
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
    
    // Provide fallback analysis when OpenAI API is unavailable
    const fallbackAnalysis = generateFallbackAnalysis(summary);
    
    return c.json({
      success: true,
      analysis: fallbackAnalysis,
      summary,
      note: 'AI APIが一時的に利用できないため、基本的な分析結果を表示しています。'
    });
  }
});

// KPI explanation endpoint
app.get('/api/kpi-help', (c) => {
  const kpiInfo = {
    title: 'KPI指標の説明',
    description: 'Meta広告分析で使用される主要指標の詳細解説',
    metrics: [
      {
        name: 'CTR (Click Through Rate)',
        japanese: 'クリック率',
        definition: '広告が表示された回数に対して、実際にクリックされた割合を示す指標',
        formula: 'CTR = (クリック数 ÷ インプレッション数) × 100',
        example: '1,000回表示されて20回クリックされた場合、CTR = 2.0%',
        goodRange: '1.5% - 3.0%',
        importance: '広告の魅力度やターゲティング精度を測る重要な指標',
        improvementTips: [
          '魅力的な広告クリエイティブの作成',
          'ターゲットオーディエンスの最適化', 
          'キャッチコピーの改善',
          'ビジュアル素材の品質向上'
        ]
      },
      {
        name: 'CPC (Cost Per Click)',
        japanese: 'クリック単価',
        definition: '1回のクリックを獲得するために必要な平均コスト',
        formula: 'CPC = 総広告費 ÷ 総クリック数',
        example: '10,000円の広告費で100クリック獲得した場合、CPC = 100円',
        goodRange: '50円 - 200円（業界による）',
        importance: '広告効率と予算管理の重要な指標',
        improvementTips: [
          '品質スコアの向上',
          '入札戦略の最適化',
          'キーワードやターゲティングの精度向上',
          '広告ランクの改善'
        ]
      },
      {
        name: 'CPA (Cost Per Acquisition)',
        japanese: '獲得単価・コンバージョン単価',
        definition: '1件の成果（フォロー、購入等）を獲得するために必要な平均コスト',
        formula: 'CPA = 総広告費 ÷ 総成果数',
        example: '10,000円の広告費で50フォロー獲得した場合、CPA = 200円',
        goodRange: '100円 - 500円（目標による）',
        importance: 'ROI（投資収益率）の評価において最重要指標',
        improvementTips: [
          'ランディングページの最適化',
          'オファーの魅力度向上',
          'ターゲットユーザーの精緻化',
          'コンバージョンファネルの改善'
        ]
      },
      {
        name: 'Follow Rate',
        japanese: 'フォロー率',
        definition: '広告にリーチしたユーザーの中で、実際にフォローしたユーザーの割合',
        formula: 'フォロー率 = (新規フォロワー数 ÷ リーチ数) × 100',
        example: '10,000人にリーチして100人がフォローした場合、フォロー率 = 1.0%',
        goodRange: '0.5% - 2.0%',
        importance: 'ブランド認知度とエンゲージメントの質を示す指標',
        improvementTips: [
          'ブランドメッセージの明確化',
          'コンテンツ品質の向上',
          'フォローするメリットの訴求',
          'インフルエンサーとのコラボレーション'
        ]
      }
    ],
    benchmarks: {
      title: '業界ベンチマーク',
      note: '以下は一般的な目安値です。業界や商品によって大きく異なります。',
      ranges: [
        { metric: 'CTR', excellent: '3.0%以上', good: '1.5-3.0%', average: '0.8-1.5%', poor: '0.8%未満' },
        { metric: 'CPC', excellent: '50円未満', good: '50-150円', average: '150-300円', poor: '300円以上' },
        { metric: 'CPA', excellent: 'LTV*10%未満', good: 'LTV*10-20%', average: 'LTV*20-40%', poor: 'LTV*40%以上' },
        { metric: 'フォロー率', excellent: '2.0%以上', good: '1.0-2.0%', average: '0.5-1.0%', poor: '0.5%未満' }
      ]
    },
    optimization: {
      title: '最適化のアプローチ',
      steps: [
        '1. 現在の各KPI値を業界ベンチマークと比較',
        '2. 最も改善余地の大きい指標を特定',
        '3. その指標に影響する要素を分析',
        '4. A/Bテストで改善施策を検証',
        '5. 継続的なモニタリングと調整'
      ]
    }
  };

  return c.json(kpiInfo);
});

// Health check endpoint
app.get('/api/health', (c) => {
  return c.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Test fallback analysis endpoint (デモ用)
app.post('/api/test-fallback', async (c) => {
  try {
    const { csvData } = await c.req.json();
    
    if (!csvData || !Array.isArray(csvData)) {
      return c.json({ error: 'Invalid CSV data' }, 400);
    }

    // Calculate summary (同じロジック)
    const summary = {
      totalCampaigns: csvData.length,
      totalSpend: 0,
      totalResults: 0,
      totalFollowers: 0,
      totalReach: 0,
      totalImpressions: 0,
      campaigns: []
    };

    csvData.forEach(row => {
      const spend = parseFloat(row['消化金額']) || 0;
      const results = parseFloat(row['結果']) || 0;
      const followers = parseFloat(row['フォロワー']) || 0;
      const reach = parseFloat(row['リーチ']) || 0;
      const impressions = parseFloat(row['インプレッション']) || 0;

      summary.totalSpend += spend;
      summary.totalResults += results;
      summary.totalFollowers += followers;
      summary.totalReach += reach;
      summary.totalImpressions += impressions;
    });

    summary.avgCTR = summary.totalImpressions > 0 ? (summary.totalResults / summary.totalImpressions * 100) : 0;
    summary.avgCPC = summary.totalResults > 0 ? (summary.totalSpend / summary.totalResults) : 0;
    summary.avgCPA = summary.totalFollowers > 0 ? (summary.totalSpend / summary.totalFollowers) : 0;
    summary.avgFollowRate = summary.totalReach > 0 ? (summary.totalFollowers / summary.totalReach * 100) : 0;

    const fallbackAnalysis = generateFallbackAnalysis(summary);

    return c.json({
      success: true,
      analysis: fallbackAnalysis,
      summary,
      note: 'フォールバック分析のテスト結果です。'
    });

  } catch (error) {
    console.error('Test Fallback error:', error);
    return c.json({ 
      error: 'テスト中にエラーが発生しました',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
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
          
          /* Tooltip Animation */
          .tooltip-show {
            opacity: 1 !important;
            visibility: visible !important;
            transform: translateY(0) !important;
          }
          
          /* Accordion Animation */
          .accordion-content {
            max-height: 0;
            overflow: hidden;
            transition: max-height 0.3s ease-out;
          }
          
          .accordion-content.expanded {
            max-height: 500px;
            transition: max-height 0.3s ease-in;
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

            <!-- 5 Card Layout -->
            <section class="grid lg:grid-cols-2 xl:grid-cols-3 gap-8">
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
                    <div class="flex items-center justify-between mb-6">
                        <div class="flex items-center">
                            <i class="fas fa-tachometer-alt text-blue-400 text-2xl mr-3"></i>
                            <h3 class="text-xl font-semibold text-white">主要KPI</h3>
                        </div>
                        <div class="flex space-x-2">
                            <button id="exportBtn" class="px-3 py-1 bg-green-500/20 text-green-200 rounded text-sm hover:bg-green-500/30 transition-colors" title="分析結果をCSVでダウンロード">
                                <i class="fas fa-download mr-1"></i>CSV出力
                            </button>
                            <button id="kpiHelpBtn" class="px-3 py-1 bg-blue-500/20 text-blue-200 rounded text-sm hover:bg-blue-500/30 transition-colors">
                                <i class="fas fa-question-circle mr-1"></i>説明
                            </button>
                        </div>
                    </div>
                    <div id="kpiDisplay" class="grid grid-cols-2 gap-4">
                        <div class="text-center p-4 bg-white/5 rounded-lg hover:bg-white/10 transition-colors cursor-help" title="クリック率 - 広告がクリックされた割合">
                            <div class="text-2xl font-bold text-purple-400" id="ctrValue">-</div>
                            <div class="text-sm text-gray-300">平均CTR</div>
                            <div class="text-xs text-gray-400 mt-1">クリック率</div>
                        </div>
                        <div class="text-center p-4 bg-white/5 rounded-lg hover:bg-white/10 transition-colors cursor-help" title="クリック単価 - 1クリックあたりの平均コスト">
                            <div class="text-2xl font-bold text-blue-400" id="cpcValue">-</div>
                            <div class="text-sm text-gray-300">平均CPC</div>
                            <div class="text-xs text-gray-400 mt-1">クリック単価</div>
                        </div>
                        <div class="text-center p-4 bg-white/5 rounded-lg hover:bg-white/10 transition-colors cursor-help" title="獲得単価 - 1フォロワー獲得あたりの平均コスト">
                            <div class="text-2xl font-bold text-indigo-400" id="cpaValue">-</div>
                            <div class="text-sm text-gray-300">平均CPA</div>
                            <div class="text-xs text-gray-400 mt-1">獲得単価</div>
                        </div>
                        <div class="text-center p-4 bg-white/5 rounded-lg hover:bg-white/10 transition-colors cursor-help" title="フォロー率 - リーチしたユーザーがフォローした割合">
                            <div class="text-2xl font-bold text-pink-400" id="followRateValue">-</div>
                            <div class="text-sm text-gray-300">フォロー率</div>
                            <div class="text-xs text-gray-400 mt-1">エンゲージメント</div>
                        </div>
                    </div>
                    <div id="exportStatus" class="mt-4 text-sm text-gray-300"></div>
                </div>

                <!-- Card 3: Charts -->
                <div class="glass-card rounded-xl p-6 hover-scale">
                    <div class="flex items-center mb-6">
                        <i class="fas fa-chart-bar text-indigo-400 text-2xl mr-3"></i>
                        <h3 class="text-xl font-semibold text-white">グラフ分析</h3>
                    </div>
                    <div class="h-64 chart-container">
                        <canvas id="performanceChart" class="w-full h-full"></canvas>
                    </div>
                    <div class="mt-4 flex justify-center space-x-2">
                        <button class="px-4 py-2 bg-purple-500/20 text-purple-200 rounded-lg text-sm hover:bg-purple-500/30 transition-colors" onclick="switchChart('ctr')">CTR比較</button>
                        <button class="px-4 py-2 bg-blue-500/20 text-blue-200 rounded-lg text-sm hover:bg-blue-500/30 transition-colors" onclick="switchChart('cpa')">CPA比較</button>
                        <button class="px-4 py-2 bg-indigo-500/20 text-indigo-200 rounded-lg text-sm hover:bg-indigo-500/30 transition-colors" onclick="switchChart('scatter')">散布図</button>
                    </div>
                </div>

                <!-- Card 4: Creative Rankings -->
                <div class="glass-card rounded-xl p-6 hover-scale">
                    <div class="flex items-center justify-between mb-6">
                        <div class="flex items-center">
                            <i class="fas fa-trophy text-yellow-400 text-2xl mr-3"></i>
                            <h3 class="text-xl font-semibold text-white">クリエイティブランキング</h3>
                            <div class="relative ml-2">
                                <i class="fas fa-info-circle text-gray-400 text-sm cursor-help" id="rankingTooltipTrigger"></i>
                                <div id="rankingTooltip" class="absolute left-6 top-0 w-80 bg-gray-900/95 backdrop-blur-sm text-white text-sm rounded-lg p-4 shadow-xl border border-gray-600 z-50 opacity-0 invisible transition-all duration-300 transform translate-y-2">
                                    <div class="font-semibold mb-2">▼ 総合パフォーマンススコアの内訳</div>
                                    <p class="mb-3">このランキングは、以下の3つの指標を総合的に評価して算出されています。</p>
                                    <ul class="space-y-1">
                                        <li><strong>• CTR (クリック率): 40%</strong><br>　広告がユーザーの興味を惹いたか</li>
                                        <li><strong>• フォロー率: 30%</strong><br>　広告から効率的にフォロワーを獲得できたか</li>
                                        <li><strong>• コスト効率 (CPC): 30%</strong><br>　クリックを安く獲得できたか</li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                        <button onclick="exportToCSV()" class="px-3 py-1 bg-green-500/20 text-green-200 rounded text-sm hover:bg-green-500/30 transition-colors" title="ランキング結果をCSVでダウンロード">
                            <i class="fas fa-file-csv mr-1"></i>CSV出力
                        </button>
                    </div>
                    <div id="creativeRankings" class="space-y-3">
                        <div class="flex items-center justify-center py-8">
                            <div class="text-center">
                                <i class="fas fa-chart-line text-4xl text-gray-500 mb-4"></i>
                                <p>CSVをアップロードしてランキングを表示</p>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Card 5: AI Analysis -->
                <div class="glass-card rounded-xl p-6 hover-scale">
                    <div class="flex items-center justify-between mb-6">
                        <div class="flex items-center">
                            <i class="fas fa-robot text-pink-400 text-2xl mr-3"></i>
                            <h3 class="text-xl font-semibold text-white">AI分析コメント</h3>
                        </div>
                        <div class="flex space-x-2">
                            <button onclick="exportAIAnalysisToCSV()" class="px-3 py-1 bg-green-500/20 text-green-200 rounded text-sm hover:bg-green-500/30 transition-colors" title="AI分析結果をCSVでダウンロード">
                                <i class="fas fa-file-csv mr-1"></i>CSV出力
                            </button>
                            <button id="analyzeBtn" class="px-4 py-2 btn-gradient text-white rounded-lg font-semibold hover:shadow-lg transition-all duration-300" disabled>
                                <i class="fas fa-magic mr-2"></i>AI分析実行
                            </button>
                        </div>
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

// Fallback analysis function when OpenAI API is unavailable
function generateFallbackAnalysis(summary: any): string {
  const avgCTR = summary.avgCTR || 0;
  const avgCPC = summary.avgCPC || 0;
  const avgCPA = summary.avgCPA || 0;
  const avgFollowRate = summary.avgFollowRate || 0;
  
  let analysis = `## 📊 データ分析結果\n\n`;
  
  // Performance evaluation
  analysis += `## ✅ パフォーマンス評価\n\n`;
  
  if (avgCTR > 2.0) {
    analysis += `• **CTR ${avgCTR.toFixed(2)}%**: 優秀な結果です。平均的なCTRを上回っています。\n`;
  } else if (avgCTR > 1.0) {
    analysis += `• **CTR ${avgCTR.toFixed(2)}%**: 標準的な結果です。\n`;
  } else {
    analysis += `• **CTR ${avgCTR.toFixed(2)}%**: 改善の余地があります。広告クリエイティブの見直しをお勧めします。\n`;
  }
  
  if (avgCPC < 100) {
    analysis += `• **CPC ¥${Math.round(avgCPC)}**: 低コストでの獲得ができています。\n`;
  } else if (avgCPC < 200) {
    analysis += `• **CPC ¥${Math.round(avgCPC)}**: 標準的なコストです。\n`;
  } else {
    analysis += `• **CPC ¥${Math.round(avgCPC)}**: 高めのコストです。ターゲティングの最適化をお勧めします。\n`;
  }
  
  if (avgFollowRate > 5.0) {
    analysis += `• **フォロー率 ${avgFollowRate.toFixed(2)}%**: 高いエンゲージメント率です。\n`;
  } else if (avgFollowRate > 2.0) {
    analysis += `• **フォロー率 ${avgFollowRate.toFixed(2)}%**: 標準的なエンゲージメント率です。\n`;
  } else {
    analysis += `• **フォロー率 ${avgFollowRate.toFixed(2)}%**: エンゲージメント向上の余地があります。\n`;
  }
  
  analysis += `\n## 💡 改善提案\n\n`;
  analysis += `1. **クリエイティブ最適化**: CTRを向上させるため、よりインパクトのあるビジュアルやキャッチコピーを試してみてください。\n`;
  analysis += `2. **ターゲティング精度向上**: CPCを下げるため、より具体的なオーディエンス設定を検討してください。\n`;
  analysis += `3. **A/Bテスト実施**: 複数の広告バリエーションをテストして最適な組み合わせを見つけてください。\n`;
  analysis += `4. **配信タイミング最適化**: ターゲットオーディエンスがアクティブな時間帯での配信を強化してください。\n`;
  analysis += `5. **ランディングページ改善**: コンバージョン率向上のため、LPの最適化も並行して実施してください。\n\n`;
  
  analysis += `## 📈 総合評価\n\n`;
  analysis += `総キャンペーン数: ${summary.totalCampaigns}\n`;
  analysis += `総消化金額: ¥${summary.totalSpend.toLocaleString()}\n`;
  analysis += `総結果数: ${summary.totalResults.toLocaleString()}\n`;
  analysis += `総フォロワー獲得: ${summary.totalFollowers.toLocaleString()}\n\n`;
  analysis += `*この分析は基本的なデータ評価に基づいています。より詳細なAI分析が必要な場合は、しばらく時間をおいてから再度お試しください。*`;
  
  return analysis;
}

export default app