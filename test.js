import https from 'https';

async function test() {
  const getRes = await fetch('https://soravdl.com/');
  const html = await getRes.text();
  const tokenMatch = html.match(/<meta name="csrf-token" content="(.*?)">/);
  const token = tokenMatch ? tokenMatch[1] : '';
  console.log("Token:", token);

  const cookies = getRes.headers.get('set-cookie');
  // parse cookies
  const cookieStr = cookies ? cookies.split(',').map(c => c.split(';')[0]).join('; ') : '';
  console.log("Cookies:", cookieStr);

  const postRes = await fetch('https://soravdl.com/download', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-TOKEN': token,
      'Accept': 'application/json',
      'Cookie': cookieStr,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Origin': 'https://soravdl.com',
      'Referer': 'https://soravdl.com/'
    },
    body: JSON.stringify({ url: 'https://sora.chatgpt.com/p/12345' })
  });
  const json = await postRes.text();
  console.log("Response:", json);
}
test();
