import peerConnector, { Peer } from '../../src';

const getEl = id => document.getElementById(id);
const createEl = el => document.createElement(el);

const $local = getEl('localVideo');
const $videoGroup = getEl('video-group');
const $messages = getEl('messages');
const $peerConnect = getEl('connect');

const wsConnect = ({ host, port, username, password, ssl = false }) => {
  return new Promise((resolve, reject) => {
    const accessAuth = username && password ? `${username}:${password}@` : '';
    const webSocket = new WebSocket(`${ssl ? 'wss' : 'ws'}://${accessAuth}${host}:${port}`);

    webSocket.onopen = () => resolve(webSocket);
    webSocket.onerror = () => reject(new Error('connect failed.'));
  });
};

$peerConnect.addEventListener('click', async () => {
  const type = document.querySelector('input[name="media-type"]:checked').value;
  const mediaType = type === 'screen' ? { screen: true } : { video: true, audio: true };
  const userId = Math.random().toString(16).substr(2, 8);

  try {
    const pc = await peerConnector({ mediaType });
    const ws = await wsConnect({ host: 'localhost', port: 1234 });

    const createPeer = (id) => {
      const peer = new Peer({ id, localStream: pc.stream });

      peer.on('onIceCandidate', candidate => {
        ws.send(JSON.stringify({
          event: 'candidate',
          data: {
            sender: userId,
            receiver: peer.id,
            candidate
          }
        }));
      });

      pc.addNewPeer(peer);

      return peer;
    };

    ws.onmessage = async (message) => {
      if (!message) return;

      const { event, data } = JSON.parse(message.data);

      if (data.receiver && data.receiver !== userId) return;

      if (event === 'join') {
        ws.send(JSON.stringify({
          event: 'request-peer',
          data: {
            sender: userId,
            receiver: data.sender
          }
        }));
      }

      if (event === 'request-peer') {
        const peer = createPeer(data.sender);
        peer.createDataChannel(userId);
        ws.send(JSON.stringify({
          event: 'sdp',
          data: {
            sender: userId,
            receiver: peer.id,
            sdp: await peer.createOfferSdp()
          }
        }));
      }

      if (event === 'sdp') {
        const { sender, sdp } = data;
        const peer = pc.peers.has(sender) ? pc.peers.get(sender) : createPeer(sender);
        await peer.setRemoteDescription(sdp);

        if (sdp.type === 'offer') {
          ws.send(JSON.stringify({
            event: 'sdp',
            data: {
              sender: userId,
              receiver: peer.id,
              sdp: await peer.createAnswerSdp()
            }
          }));
        }
      }

      if (event === 'candidate') {
        const { sender, candidate } = data;
        const peer = pc.peers.has(sender) ? pc.peers.get(sender) : createPeer(sender);
        peer.addIceCandidate(candidate);
      }
    };

    ws.send(JSON.stringify({ event: 'join', data: { sender: userId } }));

    if (pc.stream) {
      $local.srcObject = pc.stream;
    }

    pc.on('connect', (peer) => {
      console.log('peer connected', peer);
      console.log('peers info', pc.peers);

      const $remoteVideo = createEl('video');
      $remoteVideo.style.width = '33%';
      $remoteVideo.autoplay = true;
      $remoteVideo.srcObject = peer.remoteStream;
      $videoGroup.appendChild($remoteVideo);

      peer.on('open', () => {
        console.log('data channel open');
        peer.send('data channel connected');
      });

      peer.on('message', (data) => {
        console.log('message', data);

        const p = createEl('p');
        p.innerHTML = data;
        $messages.appendChild(p);
      });
    });
  } catch (e) {
    alert(e);
  }
});