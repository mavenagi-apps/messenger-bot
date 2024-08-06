import { Hono } from 'hono';
const app = new Hono<{ Bindings: { getSettings: any } }>();
import { MavenAGIClient } from 'mavenagi';

app.get('/webhook', async (c) => {
  const settings = JSON.parse(
    await c.env.getSettings({
      organizationId: 'maveninternal',
      agentId: 'help',
      appSecret: process.env.MAVENAGI_APP_SECRET,
    })
  );

  const url = new URL(c.req.url);
  const params = url.searchParams;
  if (params.get('hub.verify_token') === settings.verifyToken) {
    return new Response(params.get('hub.challenge'));
  } else {
    return new Response('Verification token mismatch', { status: 403 });
  }
});

app.post('/webhook', async (c) => {
  const settings = JSON.parse(
    await c.env.getSettings({
      organizationId: 'maveninternal',
      agentId: 'help',
      appSecret: process.env.MAVENAGI_APP_SECRET,
    })
  );

  const body = await c.req.json();

  console.log(body);

  for (const entry of body.entry) {
    for (const messageEvent of entry.messaging) {
      if (messageEvent.message) {
        const senderId = messageEvent.sender.id;
        const messageText = messageEvent.message.text;

        const setTypingOn = async () =>
          await fetch(
            `https://graph.facebook.com/v12.0/me/messages?access_token=${settings.pageAccessToken}`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                recipient: { id: senderId },
                sender_action: 'typing_on',
              }),
            }
          );
        await setTypingOn();
        const timeoutID = setInterval(async () => await setTypingOn(), 3000);

        const client = new MavenAGIClient({
          organizationId: 'maveninternal',
          agentId: 'help',
          appId: process.env.MAVENAGI_APP_ID,
          appSecret: process.env.MAVENAGI_APP_SECRET,
        });
        const answer = await client.conversation.ask(
          `1-${messageEvent.recipient.id}-${messageEvent.sender.id}`,
          {
            id: crypto.randomUUID(),
            text: messageText,
          }
        );
        const lastMessage = answer.messages[answer.messages.length - 1];
        const lastResponse =
          lastMessage.type === 'bot' ? lastMessage.responses[0] : null;
        const content =
          lastResponse.type === 'text'
            ? lastResponse.text
            : "I'm sorry, I am having trouble answering questions right now.";

        clearTimeout(timeoutID);

        const response = await fetch(
          `https://graph.facebook.com/v12.0/me/messages?access_token=${settings.pageAccessToken}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              recipient: { id: senderId },
              message: {
                text: content,
              },
            }),
          }
        );
        await response.json();
      }
    }
  }
  return new Response('Message processed', { status: 200 });
});

export default {
  async handleRequest({ request, getSettings }, env, ctx) {
    return app.fetch(
      request,
      {
        ...env,
        getSettings,
      },
      ctx
    );
  },
};
