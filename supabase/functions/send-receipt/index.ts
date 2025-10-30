import { Resend } from 'npm:resend'

// Pega a API Key dos "Secrets" que você salvou no Passo 2
const resendApiKey = Deno.env.get('RESEND_API_KEY')
const resend = new Resend(resendApiKey)

Deno.serve(async (req) => {
  // Pega os dados que o seu botão de "Enviar" vai mandar
  const { toEmail, participantName, receiptBody } = await req.json()

  try {
    const { data, error } = await resend.emails.send({
      // IMPORTANTE: Este é o e-mail que aparecerá como remetente.
      // Deve ser de um domínio verificado no Resend.
      from: 'Inscrição Retiro <info@alvocuritiba.com.br>', 
      to: [toEmail], // O e-mail do participante
      subject: `Comprovante - Inscrição O Retiro 2025 - ${participantName}`,
      html: receiptBody, // O corpo do e-mail em HTML
    })

    if (error) {
      console.error({ error })
      return new Response(JSON.stringify({ error: error.message }), {
        headers: { 'Content-Type': 'application/json' },
        status: 400,
      })
    }

    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    console.error(error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})