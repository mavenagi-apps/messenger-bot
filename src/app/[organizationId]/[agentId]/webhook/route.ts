import {type NextRequest, NextResponse} from "next/server";
import {MavenAGIClient, MavenAGI} from "mavenagi";
import {nanoid} from "nanoid";
import {mavenagiClient, mavenagiSettings} from "@/utils";

interface IncomingQuestion {
  question: string;
  call_sid?: string;
  caller_id?: string;
  caller_name?: string;
}

async function createOrUpdateUser(
    client: MavenAGIClient,
    id?: string,
    name?: string
) {

  if (id) {
    const identifiers: MavenAGI.AppUserIdentifier[] = [];
    const data: Record<string, MavenAGI.UserData> = {};

    if (name) {
      data['name'] = {
        value: name,
        visibility: "VISIBLE"
      }
    }
    return client.users.createOrUpdate({
      userId: {
        referenceId: `fb-${id}`,
      },
      identifiers,
      data,
    });
  } else {
    return client.users.createOrUpdate({
      userId: {
        referenceId: `anonymous-${nanoid()}`,
      },
      identifiers: [],
      data: {},
    });
  }
}

async function doesConversationExist(client: MavenAGIClient, conversationId: string, appId: string | undefined = undefined) {
  try {
    await client.conversation.get(conversationId, appId ? { appId }: undefined);
    return true;
  } catch(e) {
    return false;
  }
}

async function getConversationIdFromQuestion(client: MavenAGIClient, settings: AppSettings, incoming: IncomingQuestion) {
  let conversationId = conversationIdFromMessageId(incoming);

    if (conversationId && await doesConversationExist(client, conversationId)) {
      console.log(`Found question conversation for ${conversationId}`);
      return conversationId;
    }

  // This is a new conversation; initialize. 
  return (await initializeConversation(client, settings, incoming)).conversationId.referenceId;
}

function conversationIdFromMessageId(incoming: IncomingQuestion) {
  return incoming.call_sid ?? nanoid();
}

async function initializeConversation(
    client: MavenAGIClient,
    settings: AppSettings,
    incoming: IncomingQuestion,
) {
  const newRefId = conversationIdFromMessageId(incoming);

  const conversationInitializationPayload: MavenAGI.ConversationRequest = {
    conversationId: {referenceId: newRefId},
    messages: [],
    responseConfig: {
      capabilities: [
        MavenAGI.Capability.Markdown,
      ],
      isCopilot: false,
      responseLength: MavenAGI.ResponseLength.Short,
    },
    metadata: {
      escalation_action_enabled: "false",
    },
  };

  if (settings.conversationTags) {
    const tags: string[] = settings.conversationTags.split(",").map(tag => tag.trim());
    conversationInitializationPayload.tags = new Set(tags);
  }

  console.log(`Initializing conversation with Id ${newRefId}`);
  return client.conversation.initialize(conversationInitializationPayload);
}


async function askMaven(client: MavenAGIClient, question: string, conversationId: string, userId: string) {
  const conversation = {
    userId: {
      referenceId: userId,
    },
    conversationMessageId: {
      referenceId: nanoid(),
    },
    text: question,
  } as any;

  return await client.conversation.ask(conversationId, conversation);
}

export const GET = async (
    request: NextRequest, {
      params: {
        organizationId,
        agentId
      }
    }: { params: { organizationId: string; agentId: string; } }) => {

  const settings = await mavenagiSettings(organizationId, agentId);
  const searchParams = request.nextUrl.searchParams
  if (searchParams.get('hub.verify_token') === settings.verifyToken) {
    return new Response(searchParams.get('hub.challenge'));
  } else {
    return new Response('Verification token mismatch', { status: 403 });
  }
}

export const POST = async (
    req: NextRequest, {
      params: {
        organizationId,
        agentId
      }
    }: { params: { organizationId: string; agentId: string; } }) => {

  const body = await req.json();
  const client: MavenAGIClient = mavenagiClient(organizationId, agentId);
  const settings = await mavenagiSettings(organizationId, agentId);

  console.log(body);

  for (const entry of body.entry) {
    for (const messageEvent of entry.messaging) {
      if (messageEvent.message) {
        const senderId = messageEvent.sender.id;
        const messageText = messageEvent.message.text;
        const userId = (await createOrUpdateUser(client, senderId)).userId.referenceId

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
        const conversationId = await`1-${messageEvent.recipient.id}-${messageEvent.sender.id}`
        // const conversationId = await getConversationIdFromQuestion(client, settings, incoming);
        const ask = await askMaven(client, messageText, conversationId, userId);

        const markdown = ask.messages.filter(m => m.type === "bot").pop()?.responses?.filter(r => r.type === 'text').map(r => r.text).join('\n\n');
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
                  text: markdown,
                },
              }),
            }
        );
        await response.json();
      }
    }
  }
  return new Response('Message processed', { status: 200 });
/*
  const client: MavenAGIClient = mavenagiClient(organizationId, agentId);
  const settings = await mavenagiSettings(organizationId, agentId);
  const userId = (await createOrUpdateUser(client, incoming.caller_id, incoming.caller_name)).userId.referenceId
  console.log(`UserId: ${JSON.stringify(userId)}`);

  const conversationId = await getConversationIdFromQuestion(client, settings, incoming);
  const response = await askMaven(client, incoming, conversationId, userId);
  
  const markdown = response.messages.filter(m => m.type === "bot").pop()?.responses?.filter(r => r.type === 'text').map(r => r.text).join('\n\n');
  return NextResponse.json({
    response: markdown,
  }); */
}

export const maxDuration = 900;
