// フォールバック分析のテスト
const testData = [
  {
    "キャンペーン名": "夏季プロモーション",
    "消化金額": "50000",
    "結果": "1200", 
    "フォロワー": "250",
    "リーチ": "15000",
    "インプレッション": "60000"
  },
  {
    "キャンペーン名": "秋季キャンペーン",
    "消化金額": "30000",
    "結果": "800",
    "フォロワー": "150", 
    "リーチ": "10000",
    "インプレッション": "40000"
  }
];

console.log('Testing fallback API without OpenAI...');
console.log('Test data:', JSON.stringify(testData, null, 2));

// APIテストをシミュレート
fetch('http://localhost:3000/api/analyze', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ csvData: testData })
})
.then(response => response.json())
.then(data => {
  console.log('Response:', data);
  if (data.analysis) {
    console.log('\n=== AI分析結果 ===');
    console.log(data.analysis);
  }
  if (data.note) {
    console.log('\n=== 注意事項 ===');
    console.log(data.note);
  }
})
.catch(error => {
  console.error('Test failed:', error);
});