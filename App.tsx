import React, { useEffect, useRef, useState } from 'react';
import {
  SafeAreaView,
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StatusBar,
  Keyboard,
  Alert,
  ScrollView,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as DocumentPicker from 'expo-document-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';

type TabType = 'browser' | 'iptv' | 'local' | 'carplay';

interface Channel {
  id: string;
  name: string;
  group: string;
  url: string;
}

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

function NativePlayer({ sourceUrl, title, onClose }: { sourceUrl: string; title: string; onClose: () => void }) {
  const player = useVideoPlayer(sourceUrl, (p) => {
    p.loop = false;
    p.play();
  });

  return (
    <View style={styles.playerOverlay}>
      <View style={styles.playerHeader}>
        <Text style={styles.playerTitle} numberOfLines={1}>{title}</Text>
        <TouchableOpacity onPress={onClose} style={styles.closePlayerBtn}>
          <Ionicons name="close" size={22} color="#fff" />
        </TouchableOpacity>
      </View>
      <VideoView style={styles.videoBox} player={player} allowsFullscreen allowsPictureInPicture />
    </View>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('browser');

  // --- TARAYICI & YOUTUBE STATE ---
  const webViewRef = useRef<WebView>(null);
  const [url, setUrl] = useState('https://m.youtube.com');
  const [inputText, setInputText] = useState('https://m.youtube.com');
  const [isDesktop, setIsDesktop] = useState(false);
  const [isCinemaFullScreen, setIsCinemaFullScreen] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);

  // --- IPTV STATE ---
  const [m3uUrl, setM3uUrl] = useState('');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeVideo, setActiveVideo] = useState<{ url: string; title: string } | null>(null);
  const [loadingM3u, setLoadingM3u] = useState(false);

  // --- YEREL MEDYA STATE ---
  const [localVideos, setLocalVideos] = useState<{ name: string; uri: string }[]>([]);

  // --- CARPLAY / YAYIN AYARLARI STATE ---
  const [broadcastFps, setBroadcastFps] = useState<30 | 60>(60);
  const [broadcastBitrate, setBroadcastBitrate] = useState<'4 Mbps' | '8 Mbps' | '12 Mbps'>('12 Mbps');
  const [isBroadcasting, setIsBroadcasting] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('saved_channels').then((data) => {
      if (data) setChannels(JSON.parse(data));
    });
  }, []);

  const parseM3U = (content: string): Channel[] => {
    const lines = content.split(/\r?\n/);
    const parsed: Channel[] = [];
    let currentName = 'Bilinmeyen Kanal';
    let currentGroup = 'Genel';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('#EXTINF:')) {
        const groupMatch = line.match(/group-title="([^"]*)"/);
        if (groupMatch) currentGroup = groupMatch[1] || 'Genel';
        const commaIndex = line.lastIndexOf(',');
        if (commaIndex !== -1) currentName = line.substring(commaIndex + 1).trim();
      } else if (line.startsWith('http://') || line.startsWith('https://')) {
        parsed.push({
          id: `${parsed.length}-${Date.now()}`,
          name: currentName,
          group: currentGroup,
          url: line,
        });
        currentName = 'Bilinmeyen Kanal';
      }
    }
    return parsed;
  };

  const handleLoadM3U = async () => {
    if (!m3uUrl.trim()) return;
    setLoadingM3u(true);
    try {
      const res = await fetch(m3uUrl.trim());
      const text = await res.text();
      const list = parseM3U(text);
      if (list.length === 0) {
        Alert.alert('Hata', 'M3U listesinde geçerli yayın akışı bulunamadı.');
      } else {
        setChannels(list);
        await AsyncStorage.setItem('saved_channels', JSON.stringify(list));
        Alert.alert('Başarılı', `${list.length} kanal yüklendi.`);
      }
    } catch {
      Alert.alert('Bağlantı Hatası', 'M3U adresi indirilemedi. Linki kontrol edin.');
    } finally {
      setLoadingM3u(false);
    }
  };

  const pickLocalVideo = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: 'video/*', copyToCacheDirectory: true });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      const asset = result.assets[0];
      setLocalVideos((prev) => [{ name: asset.name, uri: asset.uri }, ...prev]);
      setActiveVideo({ url: asset.uri, title: asset.name });
    }
  };

  const handleNavigate = () => {
    Keyboard.dismiss();
    let target = inputText.trim();
    if (!target) return;
    if (!target.startsWith('http://') && !target.startsWith('https://')) {
      target = target.includes('.') && !target.includes(' ')
        ? 'https://' + target
        : `https://m.youtube.com/results?search_query=${encodeURIComponent(target)}`;
    }
    setUrl(target);
  };

  const injectedJS = `
    (function() {
      const fixVideos = () => {
        document.querySelectorAll('video').forEach(v => {
          v.setAttribute('playsinline', 'true');
          v.setAttribute('webkit-playsinline', 'true');
        });
      };
      fixVideos();
      new MutationObserver(fixVideos).observe(document.body, { childList: true, subtree: true });
    })();
    true;
  `;

  const filteredChannels = channels.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.group.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" hidden={isCinemaFullScreen} />

      {/* Tam Ekran Video Oynatıcı (IPTV ve Yerel Videolar İçin) */}
      {activeVideo && (
        <NativePlayer
          sourceUrl={activeVideo.url}
          title={activeVideo.title}
          onClose={() => setActiveVideo(null)}
        />
      )}

      {/* 1. SEKME: YOUTUBE & WEB TARAYICI */}
      {activeTab === 'browser' && (
        <View style={styles.flex1}>
          {!isCinemaFullScreen && (
            <View style={styles.topBar}>
              <TouchableOpacity
                style={[styles.iconBtn, !canGoBack && styles.disabledBtn]}
                onPress={() => webViewRef.current?.goBack()}
                disabled={!canGoBack}
              >
                <Ionicons name="chevron-back" size={20} color="#fff" />
              </TouchableOpacity>
              <TextInput
                style={styles.urlInput}
                value={inputText}
                onChangeText={setInputText}
                onSubmitEditing={handleNavigate}
                placeholder="YouTube'da ara veya URL gir..."
                placeholderTextColor="#888"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={() => {
                  const next = !isDesktop;
                  setIsDesktop(next);
                  setUrl(next ? 'https://www.youtube.com' : 'https://m.youtube.com');
                }}
              >
                <Ionicons name={isDesktop ? 'phone-portrait' : 'desktop'} size={18} color="#38BDF8" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconBtn} onPress={() => setIsCinemaFullScreen(true)}>
                <Ionicons name="expand" size={18} color="#22C55E" />
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.flex1}>
            <WebView
              ref={webViewRef}
              source={{ uri: url }}
              userAgent={isDesktop ? DESKTOP_UA : MOBILE_UA}
              allowsInlineMediaPlayback={true}
              mediaPlaybackRequiresUserAction={false}
              allowsFullscreenVideo={true}
              javaScriptEnabled={true}
              domStorageEnabled={true}
              sharedCookiesEnabled={true}
              injectedJavaScript={injectedJS}
              onNavigationStateChange={(nav) => {
                setCanGoBack(nav.canGoBack);
                setInputText(nav.url);
              }}
              style={styles.webview}
            />
            {isCinemaFullScreen && (
              <TouchableOpacity style={styles.exitFullBtn} onPress={() => setIsCinemaFullScreen(false)}>
                <Ionicons name="contract" size={18} color="#fff" />
                <Text style={styles.exitFullText}>Çık</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* 2. SEKME: IPTV (M3U / M3U8) */}
      {activeTab === 'iptv' && (
        <View style={styles.sectionContainer}>
          <Text style={styles.headerTitle}>IPTV & M3U Oynatıcı</Text>
          <View style={styles.rowGap}>
            <TextInput
              style={styles.urlInput}
              value={m3uUrl}
              onChangeText={setM3uUrl}
              placeholder="M3U / M3U8 playlist linki yapıştırın..."
              placeholderTextColor="#888"
              autoCapitalize="none"
            />
            <TouchableOpacity style={styles.primaryBtn} onPress={handleLoadM3U} disabled={loadingM3u}>
              <Text style={styles.primaryBtnText}>{loadingM3u ? '...' : 'Yükle'}</Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={[styles.urlInput, { marginTop: 10, flex: 0 }]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={`Kanallarda ara (${channels.length} kanal)...`}
            placeholderTextColor="#888"
          />

          <FlatList
            data={filteredChannels}
            keyExtractor={(item) => item.id}
            style={{ marginTop: 12 }}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.listItem}
                onPress={() => setActiveVideo({ url: item.url, title: item.name })}
              >
                <Ionicons name="tv-outline" size={22} color="#38BDF8" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitle}>{item.name}</Text>
                  <Text style={styles.itemSub}>{item.group}</Text>
                </View>
                <Ionicons name="play-circle" size={26} color="#22C55E" />
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <Text style={styles.emptyText}>Henüz kanal listesi eklenmedi. Yukarıdan M3U linki yükleyin.</Text>
            }
          />
        </View>
      )}

      {/* 3. SEKME: YEREL VİDEO & MEDYA */}
      {activeTab === 'local' && (
        <View style={styles.sectionContainer}>
          <Text style={styles.headerTitle}>Yerel Medya & Dosyalar</Text>
          <TouchableOpacity style={styles.uploadBox} onPress={pickLocalVideo}>
            <Ionicons name="folder-open-outline" size={34} color="#38BDF8" />
            <Text style={styles.uploadTitle}>iPhone Dosyalar'dan Video Seç</Text>
            <Text style={styles.itemSub}>MP4, MKV, MOV ve yerel medya dosyaları</Text>
          </TouchableOpacity>

          <FlatList
            data={localVideos}
            keyExtractor={(item, idx) => `${idx}-${item.name}`}
            style={{ marginTop: 16 }}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.listItem}
                onPress={() => setActiveVideo({ url: item.uri, title: item.name })}
              >
                <Ionicons name="film-outline" size={22} color="#A855F7" />
                <Text style={[styles.itemTitle, { flex: 1 }]} numberOfLines={1}>{item.name}</Text>
                <Ionicons name="play-circle" size={26} color="#22C55E" />
              </TouchableOpacity>
            )}
          />
        </View>
      )}

      {/* 4. SEKME: CARPLAY & EKRAN YAYINI */}
      {activeTab === 'carplay' && (
        <ScrollView style={styles.sectionContainer}>
          <Text style={styles.headerTitle}>CarPlay & Ekran Yayını</Text>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Yayın Kalitesi (Pro Modu)</Text>
            <View style={styles.chipRow}>
              {[30, 60].map((fps) => (
                <TouchableOpacity
                  key={fps}
                  style={[styles.chip, broadcastFps === fps && styles.chipActive]}
                  onPress={() => setBroadcastFps(fps as 30 | 60)}
                >
                  <Text style={styles.chipText}>{fps} FPS</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.chipRow}>
              {(['4 Mbps', '8 Mbps', '12 Mbps'] as const).map((rate) => (
                <TouchableOpacity
                  key={rate}
                  style={[styles.chip, broadcastBitrate === rate && styles.chipActive]}
                  onPress={() => setBroadcastBitrate(rate)}
                >
                  <Text style={styles.chipText}>{rate}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <TouchableOpacity
            style={[styles.broadcastBtn, isBroadcasting && { backgroundColor: '#EF4444' }]}
            onPress={() => {
              setIsBroadcasting(!isBroadcasting);
              Alert.alert(
                'ReplayKit Köprüsü',
                !isBroadcasting
                  ? `Yayın hazır (${broadcastFps} FPS / ${broadcastBitrate}). Gerçek CarPlay aktarımı için projeyi native iOS (.ipa) olarak derlemeniz gerekir.`
                  : 'Ekran yayını durduruldu.'
              );
            }}
          >
            <Ionicons name="car-sport" size={24} color="#fff" />
            <Text style={styles.broadcastBtnText}>
              {isBroadcasting ? 'CarPlay Yayınını Durdur' : 'CarPlay Ekran Yayınını Başlat'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* ALT ANA MENÜ */}
      {!isCinemaFullScreen && (
        <View style={styles.bottomBar}>
          <TouchableOpacity style={styles.navBtn} onPress={() => setActiveTab('browser')}>
            <Ionicons name="logo-youtube" size={22} color={activeTab === 'browser' ? '#FF0000' : '#9CA3AF'} />
            <Text style={[styles.navText, activeTab === 'browser' && styles.navTextActive]}>YouTube / Web</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.navBtn} onPress={() => setActiveTab('iptv')}>
            <Ionicons name="tv" size={22} color={activeTab === 'iptv' ? '#38BDF8' : '#9CA3AF'} />
            <Text style={[styles.navText, activeTab === 'iptv' && styles.navTextActive]}>IPTV</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.navBtn} onPress={() => setActiveTab('local')}>
            <Ionicons name="folder" size={22} color={activeTab === 'local' ? '#A855F7' : '#9CA3AF'} />
            <Text style={[styles.navText, activeTab === 'local' && styles.navTextActive]}>Yerel Medya</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.navBtn} onPress={() => setActiveTab('carplay')}>
            <Ionicons name="car-sport" size={22} color={activeTab === 'carplay' ? '#22C55E' : '#9CA3AF'} />
            <Text style={[styles.navText, activeTab === 'carplay' && styles.navTextActive]}>CarPlay</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0F19' },
  flex1: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', padding: 8, backgroundColor: '#111827', gap: 6 },
  urlInput: {
    flex: 1,
    height: 40,
    backgroundColor: '#1F2937',
    borderRadius: 10,
    paddingHorizontal: 12,
    color: '#F9FAFB',
    fontSize: 14,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#1F2937',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledBtn: { opacity: 0.4 },
  webview: { flex: 1, backgroundColor: '#000' },
  exitFullBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(17,24,39,0.8)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  exitFullText: { color: '#fff', fontWeight: '600' },
  sectionContainer: { flex: 1, padding: 16 },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 14 },
  rowGap: { flexDirection: 'row', gap: 8 },
  primaryBtn: { backgroundColor: '#2563EB', paddingHorizontal: 16, borderRadius: 10, justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '600' },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111827',
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    gap: 12,
  },
  itemTitle: { color: '#F3F4F6', fontSize: 15, fontWeight: '600' },
  itemSub: { color: '#9CA3AF', fontSize: 12, marginTop: 2 },
  emptyText: { color: '#6B7280', textAlign: 'center', marginTop: 40 },
  uploadBox: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1F2937',
    borderStyle: 'dashed',
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
    gap: 6,
  },
  uploadTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  card: { backgroundColor: '#111827', padding: 16, borderRadius: 14, marginBottom: 16 },
  cardTitle: { color: '#E5E7EB', fontSize: 15, fontWeight: '600', marginBottom: 12 },
  chipRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  chip: { flex: 1, paddingVertical: 10, backgroundColor: '#1F2937', borderRadius: 10, alignItems: 'center' },
  chipActive: { backgroundColor: '#2563EB' },
  chipText: { color: '#fff', fontWeight: '600' },
  broadcastBtn: {
    flexDirection: 'row',
    backgroundColor: '#16A34A',
    padding: 16,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  broadcastBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  playerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
    zIndex: 50,
  },
  playerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    backgroundColor: '#111827',
  },
  playerTitle: { color: '#fff', fontSize: 15, fontWeight: '600', flex: 1, marginRight: 10 },
  closePlayerBtn: { padding: 4 },
  videoBox: { flex: 1 },
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 10,
    backgroundColor: '#111827',
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
  },
  navBtn: { alignItems: 'center', gap: 4 },
  navText: { color: '#9CA3AF', fontSize: 11 },
  navTextActive: { color: '#fff', fontWeight: '600' },
});