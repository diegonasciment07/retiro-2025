import { Resend } from 'npm:resend'

// Pega a API Key dos "Secrets"
const resendApiKey = Deno.env.get('RESEND_API_KEY')
const resend = new Resend(resendApiKey)

// 1. DEFINIR OS CABEÇALHOS CORS AQUI
//    Usar '*' (asterisco) permite que seu site chame a função
//    tanto de 'localhost' (testes) quanto de 'www.alvocuritiba.com.br'
const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // Permite qualquer origem
  'Access-Control-Allow-Methods': 'POST, OPTIONS', // Métodos permitidos
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', // Headers que o Supabase client envia
}

Deno.serve(async (req) => {

  // 2. RESPONDER À REQUISIÇÃO "PREFLIGHT" OPTIONS
  // O navegador envia isso ANTES do POST para verificar a permissão
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Pega os dados que o seu botão de "Enviar" vai mandar
  const { toEmail, participantName, receiptBody } = await req.json()

  try {
    const { data, error } = await resend.emails.send({
      from: 'Inscrição Retiro <info@alvocuritiba.com.br>', 
      to: [toEmail], 
      subject: `Comprovante - Inscrição O Retiro 2025 - ${participantName}`,
      html: receiptBody, 
    })

    if (error) {
      console.error({ error })
      return new Response(JSON.stringify({ error: error.message }), {
        // 3. ADICIONAR HEADERS AQUI
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      })
    }

    return new Response(JSON.stringify(data), {
      // 4. ADICIONAR HEADERS AQUI
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    console.error(error)
    return new Response(JSON.stringify({ error: error.message }), {
      // 5. ADICIONAR HEADERS AQUI
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})