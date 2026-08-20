import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { collection, query, orderBy, onSnapshot, doc, updateDoc, deleteDoc, getDocs, getDoc, where, setDoc, addDoc, writeBatch } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { auth, db, storage } from '../../firebase/config';
import { 
  LogOut, Plus, Lock, Unlock, Copy, ExternalLink, 
  RefreshCw, FileText, Download, Check, AlertCircle, Eye, Search, X,
  Folder, FolderOpen, ChevronRight, ChevronDown, ArrowLeft, File, Trash2,
  Settings, Upload, Image as ImageIcon, CheckSquare, Mic, Edit
} from 'lucide-react';
import { applyWatermark } from '../../utils/watermarkProcessor';
import { AdminLayout } from './AdminLayout';
import { ChecklistModal, type ChecklistItem } from './ChecklistModal';
import { QRCodeGenerator } from '../Common/QRCodeGenerator';
import type { SpecialPerson } from '../../utils/excelExporter';

interface ClassData {
  id: string;
  schoolName: string;
  diriginteName: string;
  studentList: string[];
  status: 'active' | 'locked';
  requireEmailDownload: boolean;
  extraPagesPrice: number;
  folderSeparatPrice?: number;
  cosuriScoasePrice?: number;
  extraClassPayment?: number;
  specialPersons?: SpecialPerson[];
  googleSheetUrl?: string;
  galleryPhotos?: any[];
  galleryType?: 'flat' | 'folder';
  deadline?: any;
  createdAt?: any;
  checklist?: ChecklistItem[];
  enableVoiceMessage?: boolean;
  albumTypesEnabled?: boolean;
  priceAlbumMare?: number;
  priceAlbumMic?: number;
  minPhotos?: number;
  maxPhotos?: number;
  minPhotosAlbumMare?: number;
  maxPhotosAlbumMare?: number;
  minPhotosAlbumMic?: number;
  maxPhotosAlbumMic?: number;
  enableObservatii?: boolean;
  enablePoster?: boolean;
  enableSonete?: boolean;
  enableSonetPhoto?: boolean;
  enableSonetCitat?: boolean;
  priceSonet?: number;
  enableExtraItems?: boolean;
  watermarkEnabled?: boolean;
  watermarkPosition?: any;
  watermarkOffsetX?: number;
  watermarkOffsetY?: number;
}

interface DownloadLog {
  id: string;
  classId?: string;
  galleryId?: string;
  schoolName?: string;
  galleryTitle?: string;
  email: string;
  filesList: string[];
  downloadedAt: any;
}

interface ClassUploadJob {
  classId: string;
  className: string;
  filesTotal: number;
  filesUploaded: number;
  isFinished: boolean;
  progressMap: Record<string, { name: string; progress: number; status: string }>;
}

export const AdminDashboard: React.FC = () => {
  const [classes, setClasses] = useState<ClassData[]>([]);
  const [downloadLogs, setDownloadLogs] = useState<DownloadLog[]>([]);
  const [submissions, setSubmissions] = useState<Record<string, any>>({});
  const [selectedSubmission, setSelectedSubmission] = useState<any | null>(null);
  const [searchStudentQuery, setSearchStudentQuery] = useState('');
  const [searchClassQuery, setSearchClassQuery] = useState('');
  const [studentZipProgress, setStudentZipProgress] = useState<Record<string, number>>({});
  const [classZipProgress, setClassZipProgress] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { tab: tabParam, classId: classIdParam, studentId: studentIdParam } =
    useParams<{ tab?: string; classId?: string; studentId?: string }>();
  const activeTab: 'classes' | 'galleries' | 'watermark' =
    tabParam === 'galleries' ? 'galleries' : tabParam === 'watermark' ? 'watermark' : 'classes';
  // URL is the source of truth for drill-down state — no local selection state to fall out of sync
  const selectedClass = classIdParam ? (classes.find(c => c.id === classIdParam) ?? null) : null;
  const expandedStudent = studentIdParam ?? null;
  const [copiedId, setCopiedId] = useState<{ id: string; type: 'config' | 'gallery' | 'public_gallery' | 'gallery_clean' | 'gsheet' } | null>(null);
  
  // Download logs modal state
  const [selectedLogsItem, setSelectedLogsItem] = useState<{ id: string; title: string; type: 'class' | 'gallery' } | null>(null);
  const [searchLogEmailQuery, setSearchLogEmailQuery] = useState('');
  
  // Photo Galleries States
  const [photoGalleries, setPhotoGalleries] = useState<any[]>([]);
  const [deletingGalleryIds, setDeletingGalleryIds] = useState<Set<string>>(new Set());
  const [galleryPhotoCounts, setGalleryPhotoCounts] = useState<Record<string, number>>({});
  const [watermarkSettings, setWatermarkSettings] = useState<any | null>(null);
  const [albumWatermark, setAlbumWatermark] = useState<any | null>(null);
  const [watermarkError, setWatermarkError] = useState<string | null>(null);
  const [galleriesError, setGalleriesError] = useState<string | null>(null);
  const [isUploadingWatermark, setIsUploadingWatermark] = useState(false);
  const [watermarkUploadProgress, setWatermarkUploadProgress] = useState<number | null>(null);
  const [isUploadingAlbumWatermark, setIsUploadingAlbumWatermark] = useState(false);
  const [albumWatermarkUploadProgress, setAlbumWatermarkUploadProgress] = useState<number | null>(null);
  const [applyAlbumWatermarkToggle, setApplyAlbumWatermarkToggle] = useState(false);
  const [searchGalleryQuery, setSearchGalleryQuery] = useState('');

  // Active Checklist Modal State
  const [activeChecklistModal, setActiveChecklistModal] = useState<{
    type: 'class' | 'gallery';
    id: string;
    title: string;
    subtitle?: string;
    items: ChecklistItem[];
  } | null>(null);
  
  // Gallery Drag & Drop Reordering States
  const [draggedGalleryIndex, setDraggedGalleryIndex] = useState<number | null>(null);
  const [dragOverGalleryIndex, setDragOverGalleryIndex] = useState<number | null>(null);

  // Edit Class Params Modal States
  const [showEditClassParamsModal, setShowEditClassParamsModal] = useState(false);
  const [editPriceAlbumMare, setEditPriceAlbumMare] = useState<number>(150);
  const [editPriceAlbumMic, setEditPriceAlbumMic] = useState<number>(100);
  const [editPriceSonet, setEditPriceSonet] = useState<number>(25);
  const [editExtraPagesPrice, setEditExtraPagesPrice] = useState<number>(15);
  const [editMinPhotos, setEditMinPhotos] = useState<number>(4);
  const [editMaxPhotos, setEditMaxPhotos] = useState<number>(20);
  const [editFolderSeparatPrice, setEditFolderSeparatPrice] = useState<number>(0);
  const [editCosuriScoasePrice, setEditCosuriScoasePrice] = useState<number>(0);
  const [editExtraClassPayment, setEditExtraClassPayment] = useState<number>(0);
  const [editSpecialPersons, setEditSpecialPersons] = useState<SpecialPerson[]>([]);
  const [newPersonName, setNewPersonName] = useState('');
  const [newPersonPrice, setNewPersonPrice] = useState<number>(0);

  const handleOpenEditClassParams = () => {
    if (!selectedClass) return;
    setEditPriceAlbumMare(selectedClass.priceAlbumMare ?? 150);
    setEditPriceAlbumMic(selectedClass.priceAlbumMic ?? 100);
    setEditPriceSonet(selectedClass.priceSonet ?? 25);
    setEditExtraPagesPrice(selectedClass.extraPagesPrice ?? 15);
    setEditMinPhotos(selectedClass.minPhotos ?? selectedClass.minPhotosAlbumMare ?? 4);
    setEditMaxPhotos(selectedClass.maxPhotos ?? selectedClass.maxPhotosAlbumMare ?? 20);
    setEditFolderSeparatPrice(selectedClass.folderSeparatPrice ?? 0);
    setEditCosuriScoasePrice(selectedClass.cosuriScoasePrice ?? 0);
    setEditExtraClassPayment(selectedClass.extraClassPayment ?? 0);
    setEditSpecialPersons(selectedClass.specialPersons || []);
    setNewPersonName('');
    setNewPersonPrice(0);
    setShowEditClassParamsModal(true);
  };

  const handleAddSpecialPerson = () => {
    if (!newPersonName.trim()) return;
    const newPerson: SpecialPerson = {
      id: Date.now().toString(),
      name: newPersonName.trim(),
      albumPrice: Number(newPersonPrice) || 0
    };
    setEditSpecialPersons(prev => [...prev, newPerson]);
    setNewPersonName('');
    setNewPersonPrice(0);
  };

  const handleRemoveSpecialPerson = (id: string) => {
    setEditSpecialPersons(prev => prev.filter(p => p.id !== id));
  };

  const handleSaveClassParams = async () => {
    if (!selectedClass) return;
    try {
      const classRef = doc(db, 'classes', selectedClass.id);
      const updatedData = {
        priceAlbumMare: Number(editPriceAlbumMare),
        priceAlbumMic: Number(editPriceAlbumMic),
        priceSonet: Number(editPriceSonet),
        extraPagesPrice: Number(editExtraPagesPrice),
        minPhotos: Number(editMinPhotos),
        maxPhotos: Number(editMaxPhotos),
        minPhotosAlbumMare: Number(editMinPhotos),
        maxPhotosAlbumMare: Number(editMinPhotos),
        minPhotosAlbumMic: Number(editMinPhotos),
        maxPhotosAlbumMic: Number(editMaxPhotos),
        folderSeparatPrice: Number(editFolderSeparatPrice),
        cosuriScoasePrice: Number(editCosuriScoasePrice),
        extraClassPayment: Number(editExtraClassPayment),
        specialPersons: editSpecialPersons
      };

      await updateDoc(classRef, updatedData);

      setClasses(prev => prev.map(c => c.id === selectedClass.id ? { ...c, ...updatedData } : c));
      setShowEditClassParamsModal(false);
    } catch (err: any) {
      console.error('Eroare la salvarea parametrilor clasei:', err);
      alert('Eroare la salvarea parametrilor: ' + (err.message || err));
    }
  };

  const handleGalleryDragStart = (e: React.DragEvent, index: number) => {
    setDraggedGalleryIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleGalleryDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverGalleryIndex !== index) {
      setDragOverGalleryIndex(index);
    }
  };

  const handleGalleryDrop = async (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedGalleryIndex === null || draggedGalleryIndex === targetIndex) {
      setDraggedGalleryIndex(null);
      setDragOverGalleryIndex(null);
      return;
    }

    const updatedList = [...photoGalleries];
    const [movedGallery] = updatedList.splice(draggedGalleryIndex, 1);
    updatedList.splice(targetIndex, 0, movedGallery);

    const reorderedWithOrder = updatedList.map((g, idx) => ({ ...g, displayOrder: idx }));
    setPhotoGalleries(reorderedWithOrder);
    setDraggedGalleryIndex(null);
    setDragOverGalleryIndex(null);

    try {
      const batch = writeBatch(db);
      reorderedWithOrder.forEach((g) => {
        batch.update(doc(db, 'photo_galleries', g.id), { displayOrder: g.displayOrder });
      });
      await batch.commit();
    } catch (err) {
      console.error('Error updating gallery order:', err);
    }
  };

  const handleGalleryDragEnd = () => {
    setDraggedGalleryIndex(null);
    setDragOverGalleryIndex(null);
  };
  
  // Gallery Duplication States
  const [duplicatingGallery, setDuplicatingGallery] = useState<any | null>(null);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [duplicateProgress, setDuplicateProgress] = useState({ current: 0, total: 0 });
  const [duplicateOptions, setDuplicateOptions] = useState({ cover: true, settings: true, folders: true, photos: true });
  
  // Gallery Creation States
  const [showCreateGalleryModal, setShowCreateGalleryModal] = useState(false);
  const [newGalleryTitle, setNewGalleryTitle] = useState('');
  const [newGallerySubtitle, setNewGallerySubtitle] = useState('');
  const [newGalleryDate, setNewGalleryDate] = useState(new Date().toISOString().split('T')[0]);
  const [newGalleryWatermark, setNewGalleryWatermark] = useState(false);
  const [isCreatingGallery, setIsCreatingGallery] = useState(false);
  
  // Photographer Profile States
  const [photographerProfile, setPhotographerProfile] = useState<{ name: string; avatarUrl: string; avatarPath: string; link: string } | null>(null);
  const [profileNameInput, setProfileNameInput] = useState('');
  const [profileLinkInput, setProfileLinkInput] = useState('');
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarUploadProgress, setAvatarUploadProgress] = useState<number | null>(null);
  
  // Gallery Management States
  const [isDeletingPhoto, setIsDeletingPhoto] = useState<string | null>(null);
  const [showAddPhotosForm, setShowAddPhotosForm] = useState(false);
  const [showAllClassPhotos, setShowAllClassPhotos] = useState(false);
  // Background upload jobs: classId -> ClassUploadJob (persists across class navigation)
  const [classUploadJobs, setClassUploadJobs] = useState<Record<string, ClassUploadJob>>({});
  const [expandedUploadJob, setExpandedUploadJob] = useState<string | null>(null);
  
  const navigate = useNavigate();

  useEffect(() => {
    let unsubscribeClasses: (() => void) | undefined;
    let unsubscribeLogs: (() => void) | undefined;
    let unsubscribeSubmissions: (() => void) | undefined;
    let unsubscribeGalleries: (() => void) | undefined;
    let unsubscribeSettings: (() => void) | undefined;

    // Auth route guard & data subscriptions
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (!user) {
        navigate('/admin/login');
        return;
      }

      // Cleanup any previous subscriptions if user changes
      if (unsubscribeClasses) unsubscribeClasses();
      if (unsubscribeLogs) unsubscribeLogs();
      if (unsubscribeSubmissions) unsubscribeSubmissions();
      if (unsubscribeGalleries) unsubscribeGalleries();
      if (unsubscribeSettings) unsubscribeSettings();

      // Subscriptions to Firestore data (only run when authenticated)
      const classesQuery = query(collection(db, 'classes'), orderBy('createdAt', 'desc'));
      unsubscribeClasses = onSnapshot(
        classesQuery, 
        (snapshot) => {
          const classesData = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          })) as ClassData[];
          setClasses(classesData);
          setLoading(false);
        },
        (err) => {
          console.error('Error listening to classes:', err);
          setError('Eroare conexiune Firestore (clase): ' + err.message);
          setLoading(false);
        }
      );

      const logsQuery = query(collection(db, 'downloads'), orderBy('downloadedAt', 'desc'));
      unsubscribeLogs = onSnapshot(
        logsQuery, 
        (snapshot) => {
          const logsData = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          })) as DownloadLog[];
          setDownloadLogs(logsData);
        },
        (err) => {
          console.error('Error listening to logs:', err);
        }
      );

      const submissionsQuery = query(collection(db, 'submissions'));
      unsubscribeSubmissions = onSnapshot(
        submissionsQuery,
        (snapshot) => {
          const subsMap: Record<string, any> = {};
          snapshot.docs.forEach(doc => {
            subsMap[doc.id] = doc.data(); // Key: classId_studentName
          });
          setSubmissions(subsMap);
        },
        (err) => {
          console.error('Error listening to submissions:', err);
        }
      );

      const fetchCountsForGalleries = async (galleriesList: any[]) => {
        const countsMap: Record<string, number> = {};
        await Promise.all(
          galleriesList.map(async (gallery) => {
            let total = 0;
            let needsUpdate = false;

            const updatedSubs = await Promise.all(
              (gallery.subCollections || []).map(async (sub: any) => {
                try {
                  const snap = await getDocs(
                    collection(db, 'photo_galleries', gallery.id, 'subcollections', sub.id, 'photos')
                  );
                  const subcollectionCount = snap.docs.length;
                  const embeddedCount = Array.isArray(sub.photos) ? sub.photos.length : 0;
                  
                  // Authoritative photo count is subcollection docs if > 0, else embedded array length (0 if empty)
                  const actualCount = subcollectionCount > 0 ? subcollectionCount : embeddedCount;

                  total += actualCount;
                  if (sub.photoCount !== actualCount) {
                    needsUpdate = true;
                  }
                  return { ...sub, photoCount: actualCount };
                } catch {
                  const embeddedCount = Array.isArray(sub.photos) ? sub.photos.length : 0;
                  total += embeddedCount;
                  return { ...sub, photoCount: embeddedCount };
                }
              })
            );

            countsMap[gallery.id] = total;

            if (needsUpdate && auth.currentUser && !deletingGalleryIds.has(gallery.id)) {
              try {
                const subsMeta = updatedSubs.map(({ photos, ...meta }: any) => meta);
                await updateDoc(doc(db, 'photo_galleries', gallery.id), {
                  subCollections: subsMeta
                });
              } catch (e) {
                // Silently ignore background metadata updates
              }
            }
          })
        );
        setGalleryPhotoCounts(countsMap);
      };

      const galleriesQuery = query(collection(db, 'photo_galleries'));
      unsubscribeGalleries = onSnapshot(
        galleriesQuery,
        (snapshot) => {
          setGalleriesError(null);
          const list = snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() as any }))
            .filter(g => !deletingGalleryIds.has(g.id));
          list.sort((a: any, b: any) => {
            if (typeof a.displayOrder === 'number' && typeof b.displayOrder === 'number') {
              return a.displayOrder - b.displayOrder;
            }
            if (typeof a.displayOrder === 'number') return -1;
            if (typeof b.displayOrder === 'number') return 1;
            const dateA = a.createdAt?.seconds ? a.createdAt.seconds * 1000 : new Date(a.createdAt || 0).getTime();
            const dateB = b.createdAt?.seconds ? b.createdAt.seconds * 1000 : new Date(b.createdAt || 0).getTime();
            return dateB - dateA;
          });
          setPhotoGalleries(list);
          fetchCountsForGalleries(list);
        },
        (err) => {
          console.error('Error listening to photo galleries:', err);
          setGalleriesError(err.message);
        }
      );

      unsubscribeSettings = onSnapshot(
        doc(db, 'settings', 'global'),
        (docSnap) => {
          setWatermarkError(null);
          if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.defaultWatermark) {
              setWatermarkSettings(data.defaultWatermark);
            } else {
              setWatermarkSettings(null);
            }
            if (data.albumWatermark) {
              setAlbumWatermark(data.albumWatermark);
            } else {
              setAlbumWatermark(null);
            }
            if (data.photographerProfile) {
              setPhotographerProfile(data.photographerProfile);
              setProfileNameInput(data.photographerProfile.name || '');
              setProfileLinkInput(data.photographerProfile.link || '');
            } else {
              setPhotographerProfile(null);
            }
          } else {
            setWatermarkSettings(null);
            setAlbumWatermark(null);
            setPhotographerProfile(null);
          }
        },
        (err) => {
          console.error('Error listening to settings:', err);
          setWatermarkError(err.message);
        }
      );
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeClasses) unsubscribeClasses();
      if (unsubscribeLogs) unsubscribeLogs();
      if (unsubscribeSubmissions) unsubscribeSubmissions();
      if (unsubscribeGalleries) unsubscribeGalleries();
      if (unsubscribeSettings) unsubscribeSettings();
    };
  }, [navigate]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate('/admin/login');
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  const downloadStudentZip = async (studentName: string, sub: any) => {
    setStudentZipProgress(prev => ({ ...prev, [studentName]: 1 }));
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();

    try {
      const filesToDownload: { url: string; name: string }[] = [];

      if (sub.copertaPhoto) {
        filesToDownload.push({
          url: sub.copertaPhoto.processedUrl || sub.copertaPhoto.url,
          name: sub.copertaPhoto.name ? `coperta_${sub.copertaPhoto.bw ? 'bw_' : ''}${sub.copertaPhoto.name}` : `coperta_${sub.copertaPhoto.bw ? 'bw' : 'color'}.jpg`
        });
      }

      if (sub.colegiPhoto) {
        filesToDownload.push({
          url: sub.colegiPhoto.processedUrl || sub.colegiPhoto.url,
          name: sub.colegiPhoto.name ? `colegi_${sub.colegiPhoto.bw ? 'bw_' : ''}${sub.colegiPhoto.name}` : `colegi_${sub.colegiPhoto.bw ? 'bw' : 'color'}.jpg`
        });
      }

      if (sub.personalPhotos && Array.isArray(sub.personalPhotos)) {
        sub.personalPhotos.forEach((photo: any, index: number) => {
          filesToDownload.push({
            url: photo.processedUrl || photo.url,
            name: photo.name ? `personal_${index + 1}_${photo.bw ? 'bw_' : ''}${photo.name}` : `personal_${index + 1}_${photo.bw ? 'bw' : 'color'}.jpg`
          });
        });
      }

      if (sub.extraPhotos && Array.isArray(sub.extraPhotos)) {
        sub.extraPhotos.forEach((photo: any, index: number) => {
          filesToDownload.push({
            url: photo.processedUrl || photo.url,
            name: photo.name ? `extra_${index + 1}_${photo.bw ? 'bw_' : ''}${photo.name}` : `extra_${index + 1}_${photo.bw ? 'bw' : 'color'}.jpg`
          });
        });
      }

      // Add poster photo if selected
      if (sub.wantsPoster && sub.posterPhoto) {
        filesToDownload.push({
          url: sub.posterPhoto.processedUrl || sub.posterPhoto.url,
          name: sub.posterPhoto.name ? `poster_${sub.posterPhoto.bw ? 'bw_' : ''}${sub.posterPhoto.name}` : `poster_${sub.posterPhoto.bw ? 'bw' : 'color'}.jpg`
        });
      }

      // Add sonet photo if selected
      if (sub.wantsSonetPhoto && sub.sonetPhoto) {
        filesToDownload.push({
          url: sub.sonetPhoto.processedUrl || sub.sonetPhoto.url,
          name: sub.sonetPhoto.name ? `sonet_${sub.sonetPhoto.bw ? 'bw_' : ''}${sub.sonetPhoto.name}` : `sonet_${sub.sonetPhoto.bw ? 'bw' : 'color'}.jpg`
        });
      }

      // Add voice message audio if recorded by student
      if (sub.voiceMessageUrl) {
        filesToDownload.push({
          url: sub.voiceMessageUrl,
          name: 'mesaj_vocal.webm'
        });
      }

      // Add text details
      const albumTypeStr = sub.selectedAlbumType === 'mic' ? 'Album Mic' : 'Album Mare';
      const sonetStr = sub.hasSonet || sub.wantsSonetPhoto || sub.wantsSonetCitat ? 'Da' : 'Nu';
      const totalStr = sub.totalCost ? `${sub.totalCost} RON` : 'Nespecificat';
      const infoText = `Elev: ${studentName}\nNume pe album: ${sub.albumName || studentName}\nScoala: ${selectedClass?.schoolName || ''}\nDiriginte: ${selectedClass?.diriginteName || ''}\nTip Album: ${albumTypeStr}\nCost Total: ${totalStr}\nPoză Poster: ${sub.wantsPoster && sub.posterPhoto ? 'Da' : 'Nu'}\nSonete Școlare: ${sonetStr}\nPoză Sonet: ${sub.wantsSonetPhoto && sub.sonetPhoto ? 'Da' : 'Nu'}\nCitat Sonet: "${sub.citatSonet || ''}"\nCitat Album: "${sub.citat || ''}"\nObservatii Designer: ${sub.observatii || ''}\nCumpărături Extra: ${sub.extraItemsText || 'Nu'}\nExtra pagini poze: ${sub.extraPagesEnabled ? 'Da' : 'Nu'}\n`;
      zip.file('citat_si_observatii.txt', infoText);

      // Download files
      for (let i = 0; i < filesToDownload.length; i++) {
        const file = filesToDownload[i];
        const response = await fetch(file.url);
        const blob = await response.blob();
        zip.file(file.name, blob);
        
        const progress = Math.round(((i + 1) / filesToDownload.length) * 100);
        setStudentZipProgress(prev => ({ ...prev, [studentName]: progress }));
      }

      setStudentZipProgress(prev => ({ ...prev, [studentName]: 100 }));
      const content = await zip.generateAsync({ type: 'blob' });
      const blobUrl = window.URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `${studentName.replace(/[^a-z0-9]/gi, '_')}_selectie_album.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);

    } catch (err) {
      console.error('Error generating student ZIP:', err);
      alert('Descărcarea a eșuat. Verifică dacă CORS este activat pe bucket-ul Storage.');
    } finally {
      setStudentZipProgress(prev => {
        const copy = { ...prev };
        delete copy[studentName];
        return copy;
      });
    }
  };

  const downloadClassZip = async () => {
    if (!selectedClass) return;
    const classSubs = Object.values(submissions).filter(sub => sub.classId === selectedClass.id);
    if (classSubs.length === 0) {
      alert('Nu există nicio trimitere pentru această clasă.');
      return;
    }

    setClassZipProgress(1);
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    
    // Create root folder named after school and homeroom teacher
    const rootName = `${selectedClass.schoolName}_${selectedClass.diriginteName}`.replace(/[^a-z0-9]/gi, '_');
    const classFolder = zip.folder(rootName);
    if (!classFolder) throw new Error('Nu s-a putut crea folderul principal în ZIP.');

    try {
      // 1. First, compile the list of all files to download and prepare student folders
      const allDownloads: { url: string; folder: any; name: string }[] = [];

      classSubs.forEach(sub => {
        const studentFolder = classFolder.folder(sub.studentName.replace(/[^a-z0-9]/gi, '_'));
        if (!studentFolder) return;
        
        // Add txt file
        const albumTypeStr = sub.selectedAlbumType === 'mic' ? 'Album Mic' : 'Album Mare';
        const sonetStr = sub.hasSonet || sub.wantsSonetPhoto || sub.wantsSonetCitat ? 'Da' : 'Nu';
        const totalStr = sub.totalCost ? `${sub.totalCost} RON` : 'Nespecificat';
        const infoText = `Elev: ${sub.studentName}\nNume pe album: ${sub.albumName || sub.studentName}\nScoala: ${selectedClass.schoolName}\nDiriginte: ${selectedClass.diriginteName}\nTip Album: ${albumTypeStr}\nCost Total: ${totalStr}\nPoză Poster: ${sub.wantsPoster && sub.posterPhoto ? 'Da' : 'Nu'}\nSonete Școlare: ${sonetStr}\nPoză Sonet: ${sub.wantsSonetPhoto && sub.sonetPhoto ? 'Da' : 'Nu'}\nCitat Sonet: "${sub.citatSonet || ''}"\nCitat Album: "${sub.citat || ''}"\nObservatii Designer: ${sub.observatii || ''}\nCumpărături Extra: ${sub.extraItemsText || 'Nu'}\nExtra pagini poze: ${sub.extraPagesEnabled ? 'Da' : 'Nu'}\n`;
        studentFolder.file('citat_si_observatii.txt', infoText);

        if (sub.copertaPhoto) {
          allDownloads.push({
            url: sub.copertaPhoto.processedUrl || sub.copertaPhoto.url,
            folder: studentFolder,
            name: sub.copertaPhoto.name ? `coperta_${sub.copertaPhoto.bw ? 'bw_' : ''}${sub.copertaPhoto.name}` : `coperta_${sub.copertaPhoto.bw ? 'bw' : 'color'}.jpg`
          });
        }
        if (sub.colegiPhoto) {
          allDownloads.push({
            url: sub.colegiPhoto.processedUrl || sub.colegiPhoto.url,
            folder: studentFolder,
            name: sub.colegiPhoto.name ? `colegi_${sub.colegiPhoto.bw ? 'bw_' : ''}${sub.colegiPhoto.name}` : `colegi_${sub.colegiPhoto.bw ? 'bw' : 'color'}.jpg`
          });
        }
        if (sub.posterPhoto && sub.wantsPoster) {
          allDownloads.push({
            url: sub.posterPhoto.processedUrl || sub.posterPhoto.url,
            folder: studentFolder,
            name: sub.posterPhoto.name ? `poster_${sub.posterPhoto.bw ? 'bw_' : ''}${sub.posterPhoto.name}` : `poster_${sub.posterPhoto.bw ? 'bw' : 'color'}.jpg`
          });
        }
        if (sub.sonetPhoto && sub.wantsSonetPhoto) {
          allDownloads.push({
            url: sub.sonetPhoto.processedUrl || sub.sonetPhoto.url,
            folder: studentFolder,
            name: sub.sonetPhoto.name ? `sonet_${sub.sonetPhoto.bw ? 'bw_' : ''}${sub.sonetPhoto.name}` : `sonet_${sub.sonetPhoto.bw ? 'bw' : 'color'}.jpg`
          });
        }
        if (sub.personalPhotos && Array.isArray(sub.personalPhotos)) {
          sub.personalPhotos.forEach((photo: any, index: number) => {
            allDownloads.push({
              url: photo.processedUrl || photo.url,
              folder: studentFolder,
              name: photo.name ? `personal_${index + 1}_${photo.bw ? 'bw_' : ''}${photo.name}` : `personal_${index + 1}_${photo.bw ? 'bw' : 'color'}.jpg`
            });
          });
        }
        if (sub.extraPhotos && Array.isArray(sub.extraPhotos)) {
          sub.extraPhotos.forEach((photo: any, index: number) => {
            allDownloads.push({
              url: photo.processedUrl || photo.url,
              folder: studentFolder,
              name: photo.name ? `extra_${index + 1}_${photo.bw ? 'bw_' : ''}${photo.name}` : `extra_${index + 1}_${photo.bw ? 'bw' : 'color'}.jpg`
            });
          });
        }
      });

      const totalFiles = allDownloads.length;

      // 2. Fetch and add files
      for (let i = 0; i < totalFiles; i++) {
        const item = allDownloads[i];
        const response = await fetch(item.url);
        const blob = await response.blob();
        item.folder.file(item.name, blob);

        const progress = Math.round(((i + 1) / totalFiles) * 100);
        setClassZipProgress(progress);
      }

      // 3. Generate ZIP blob
      const content = await zip.generateAsync({ type: 'blob' });
      const blobUrl = window.URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `${rootName}_toate_albumele.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);

    } catch (err) {
      console.error('Error generating class ZIP:', err);
      alert('Descărcarea a eșuat. Verifică dacă CORS este activat pe bucket-ul Storage.');
    } finally {
      setClassZipProgress(null);
    }
  };

  const toggleClassStatus = async (classId: string, currentStatus: 'active' | 'locked') => {
    try {
      const classRef = doc(db, 'classes', classId);
      const nextStatus = currentStatus === 'active' ? 'locked' : 'active';
      await updateDoc(classRef, {
        status: nextStatus
      });
      setClasses(prev => prev.map(c => c.id === classId ? { ...c, status: nextStatus } : c));
    } catch (err) {
      console.error('Error updating status:', err);
      alert('Eroare la actualizarea statusului clasei.');
    }
  };

  const deleteClass = async (classId: string) => {
    const confirmDelete = window.confirm(
      'Ești sigur că vrei să ștergi această clasă? Toate datele asociate (albume trimise, fișiere, istoric descărcări) vor fi șterse definitiv.'
    );
    if (!confirmDelete) return;

    try {
      // 1. Delete class document
      await deleteDoc(doc(db, 'classes', classId));

      // 2. Query and delete all submissions for this class
      const subsQuery = query(collection(db, 'submissions'), where('classId', '==', classId));
      const subsSnapshot = await getDocs(subsQuery);
      const subDeletes = subsSnapshot.docs.map(docSnap => deleteDoc(docSnap.ref));
      await Promise.all(subDeletes);

      // 3. Query and delete all downloads for this class
      const downloadsQuery = query(collection(db, 'downloads'), where('classId', '==', classId));
      const downloadsSnapshot = await getDocs(downloadsQuery);
      const downloadDeletes = downloadsSnapshot.docs.map(docSnap => deleteDoc(docSnap.ref));
      await Promise.all(downloadDeletes);

      // 4. Return to root view
      navigate('/admin/dashboard/classes');
      alert('Clasa a fost ștearsă cu succes.');
    } catch (err) {
      console.error('Error deleting class:', err);
      alert('Eroare la ștergerea clasei.');
    }
  };

  const handleDeletePhoto = async (photo: any) => {
    if (!selectedClass) return;
    if (!window.confirm(`Ești sigur că vrei să ștergi imaginea "${photo.name}"?`)) return;

    const deleteKey = photo.path || photo.url || photo.name;
    setIsDeletingPhoto(deleteKey);
    try {
      // 1. Delete main file from Storage
      if (photo.path) {
        try { await deleteObject(ref(storage, photo.path)); } catch (err) { console.warn("Storage deletion warning:", err); }
      }
      // Delete clean file if present
      if (photo.cleanPath && photo.cleanPath !== photo.path) {
        try { await deleteObject(ref(storage, photo.cleanPath)); } catch {}
      }

      // 2. Delete from Firestore
      const updatedPhotos = (selectedClass.galleryPhotos || []).filter((p: any) => 
        (photo.path ? p.path !== photo.path : true) &&
        (photo.url ? p.url !== photo.url : true) &&
        p.name !== photo.name
      );

      await updateDoc(doc(db, 'classes', selectedClass.id), {
        galleryPhotos: updatedPhotos
      });

      // 3. Update local state
      setClasses(prev => prev.map(c => c.id === selectedClass.id ? { ...c, galleryPhotos: updatedPhotos } : c));
    } catch (err: any) {
      console.error("Error deleting photo:", err);
      alert(`Eroare la ștergerea fotografiei: ${err.message || err.toString()}`);
    } finally {
      setIsDeletingPhoto(null);
    }
  };

  const handleNewFilesUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedClass || !e.target.files || e.target.files.length === 0) return;
    const filesArray = Array.from(e.target.files);
    const targetClass = selectedClass; // capture at call time — user may navigate away
    const classId = targetClass.id;
    const className = targetClass.schoolName || classId;
    
    // Check if watermark is enabled either on class config or via dashboard toggle
    const isWmEnabled = !!((targetClass.watermarkEnabled || applyAlbumWatermarkToggle) && albumWatermark);
    const wmUrl = isWmEnabled && albumWatermark ? albumWatermark.url : null;
    const wmPos = targetClass.watermarkPosition || albumWatermark?.position || 'bottom-right';
    const wmOffX = targetClass.watermarkOffsetX ?? albumWatermark?.offsetX ?? 0;
    const wmOffY = targetClass.watermarkOffsetY ?? albumWatermark?.offsetY ?? 0;

    // Initialize job entry
    const initialProgress: Record<string, { name: string; progress: number; status: string }> = {};
    filesArray.forEach(file => {
      initialProgress[file.name] = { name: file.name, progress: 0, status: 'Așteptare...' };
    });
    setClassUploadJobs(prev => ({
      ...prev,
      [classId]: {
        classId,
        className,
        filesTotal: (prev[classId]?.isFinished === false ? prev[classId].filesTotal : 0) + filesArray.length,
        filesUploaded: prev[classId]?.isFinished === false ? prev[classId].filesUploaded : 0,
        isFinished: false,
        progressMap: { ...(prev[classId]?.isFinished === false ? prev[classId].progressMap : {}), ...initialProgress }
      }
    }));

    // Close the form panel immediately — user can freely navigate
    setShowAddPhotosForm(false);

    // Fire and forget — runs fully in background
    (async () => {
      const newPhotos: any[] = [];
      for (const file of filesArray) {
        try {
          setClassUploadJobs(prev => {
            const job = prev[classId];
            if (!job) return prev;
            return { ...prev, [classId]: { ...job, progressMap: { ...job.progressMap, [file.name]: { name: file.name, progress: 0, status: 'Se procesează...' } } } };
          });

          const baseFileName = `${Date.now()}_${file.name}`;
          let uploadBlob: Blob = file;
          let cleanBlob: Blob = file;
          let storagePath = `classes/${classId}/gallery/clean_${baseFileName}`;
          let cleanStoragePath = storagePath;

          if (isWmEnabled && wmUrl) {
            try {
              cleanBlob = await applyWatermark(file, null, wmPos, wmOffX, wmOffY);
              uploadBlob = await applyWatermark(file, wmUrl, wmPos, wmOffX, wmOffY);
              storagePath = `classes/${classId}/gallery/wm_${baseFileName}`;
              cleanStoragePath = `classes/${classId}/gallery/clean_${baseFileName}`;
            } catch {
              cleanBlob = file;
              uploadBlob = file;
              storagePath = `classes/${classId}/gallery/clean_${baseFileName}`;
              cleanStoragePath = storagePath;
            }
          }

          const storageRef = ref(storage, storagePath);

          let cleanUploadPromise: Promise<string> = Promise.resolve('');
          if (cleanStoragePath !== storagePath) {
            const cleanStorRef = ref(storage, cleanStoragePath);
            cleanUploadPromise = uploadBytesResumable(cleanStorRef, cleanBlob).then(snap => getDownloadURL(snap.ref)) as Promise<string>;
          }

          const uploadTask = uploadBytesResumable(storageRef, uploadBlob);

          await new Promise<void>((resolve, _reject) => {
            uploadTask.on(
              'state_changed',
              (snapshot) => {
                const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
                setClassUploadJobs(prev => {
                  const job = prev[classId];
                  if (!job) return prev;
                  return { ...prev, [classId]: { ...job, progressMap: { ...job.progressMap, [file.name]: { name: file.name, progress, status: 'Se încarcă...' } } } };
                });
              },
              (error) => {
                console.error('Upload error for file:', file.name, error);
                setClassUploadJobs(prev => {
                  const job = prev[classId];
                  if (!job) return prev;
                  return { ...prev, [classId]: { ...job, progressMap: { ...job.progressMap, [file.name]: { name: file.name, progress: 0, status: 'Eroare' } } } };
                });
                resolve(); // don't reject — continue with remaining files
              },
              async () => {
                try {
                  const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
                  const cleanUrl = cleanStoragePath !== storagePath ? await cleanUploadPromise : downloadUrl;
                  const relativePath = (file as any).webkitRelativePath || '';
                  const pathParts = relativePath.split('/');
                  const folderName = pathParts.length > 1 ? pathParts[pathParts.length - 2] : '';
                  newPhotos.push({
                    name: file.name,
                    url: downloadUrl,
                    path: storagePath,
                    cleanUrl,
                    cleanPath: cleanStoragePath,
                    ...(folderName ? { folder: folderName } : {})
                  });
                  setClassUploadJobs(prev => {
                    const job = prev[classId];
                    if (!job) return prev;
                    const newUploaded = job.filesUploaded + 1;
                    return { ...prev, [classId]: { ...job, filesUploaded: newUploaded, progressMap: { ...job.progressMap, [file.name]: { name: file.name, progress: 100, status: 'Finalizat' } } } };
                  });
                  resolve();
                } catch { resolve(); }
              }
            );
          });
        } catch (err) {
          console.error('Unexpected error uploading file:', file.name, err);
        }
      }

      // Batch-save all new photos to Firestore once all uploads done
      try {
        const classSnap = await getDoc(doc(db, 'classes', classId));
        const existing: any[] = classSnap.exists() ? (classSnap.data().galleryPhotos || []) : [];
        const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
        const merged = [...existing, ...newPhotos].sort((a, b) => collator.compare(a.name, b.name));
        await updateDoc(doc(db, 'classes', classId), { galleryPhotos: merged });

        // Refresh local state
        setClasses(prev => prev.map(c => c.id === classId ? { ...c, galleryPhotos: merged } : c));
      } catch (err) {
        console.error('Failed to save photos to Firestore:', err);
      }

      // Mark job finished
      setClassUploadJobs(prev => {
        const job = prev[classId];
        if (!job) return prev;
        return { ...prev, [classId]: { ...job, isFinished: true } };
      });
    })();
  };

  const handleWatermarkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];

    setIsUploadingWatermark(true);
    setWatermarkUploadProgress(0);

    const storagePath = `settings/global/watermark_${Date.now()}_${file.name}`;
    const storageRef = ref(storage, storagePath);

    try {
      // Delete old watermark from storage if exists
      if (watermarkSettings?.path) {
        try {
          await deleteObject(ref(storage, watermarkSettings.path));
        } catch (oldErr) {
          console.warn("Could not delete old watermark file:", oldErr);
        }
      }

      const uploadTask = uploadBytesResumable(storageRef, file);

      await new Promise<void>((resolve, reject) => {
        uploadTask.on(
          'state_changed',
          (snapshot) => {
            const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
            setWatermarkUploadProgress(progress);
          },
          (error) => reject(error),
          async () => {
            try {
              const url = await getDownloadURL(uploadTask.snapshot.ref);
              const payload = {
                defaultWatermark: {
                  url,
                  path: storagePath,
                  name: file.name
                }
              };
              await setDoc(doc(db, 'settings', 'global'), payload, { merge: true });
              alert("Watermark-ul implicit a fost salvat!");
              resolve();
            } catch (urlErr) {
              reject(urlErr);
            }
          }
        );
      });
    } catch (err: any) {
      console.error("Error uploading watermark:", err);
      alert(`Încărcarea watermark-ului a eșuat: ${err.message || err.toString()}`);
    } finally {
      setIsUploadingWatermark(false);
      setWatermarkUploadProgress(null);
      if (e.target) e.target.value = ''; // clear input
    }
  };

  const handleWatermarkDelete = async () => {
    if (!watermarkSettings) return;
    if (!window.confirm("Ești sigur că vrei să ștergi watermark-ul implicit?")) return;

    try {
      // 1. Delete from Storage
      try {
        await deleteObject(ref(storage, watermarkSettings.path));
      } catch (storageErr) {
        console.warn("Storage delete watermark warning:", storageErr);
      }

      // 2. Remove from Firestore
      await setDoc(doc(db, 'settings', 'global'), { defaultWatermark: null }, { merge: true });
      alert("Watermark-ul implicit a fost șters!");
    } catch (err: any) {
      console.error("Error deleting watermark:", err);
      alert(`Ștergerea watermark-ului a eșuat: ${err.message || err.toString()}`);
    }
  };

  const handleAlbumWatermarkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];

    setIsUploadingAlbumWatermark(true);
    setAlbumWatermarkUploadProgress(0);

    const storagePath = `settings/global/album_watermark_${Date.now()}_${file.name}`;
    const storageRef = ref(storage, storagePath);

    try {
      // Delete old album watermark if exists
      if (albumWatermark?.path) {
        try {
          await deleteObject(ref(storage, albumWatermark.path));
        } catch (oldErr) {
          console.warn("Could not delete old album watermark file:", oldErr);
        }
      }

      const uploadTask = uploadBytesResumable(storageRef, file);

      await new Promise<void>((resolve, reject) => {
        uploadTask.on(
          'state_changed',
          (snapshot) => {
            const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
            setAlbumWatermarkUploadProgress(progress);
          },
          (error) => reject(error),
          async () => {
            try {
              const url = await getDownloadURL(uploadTask.snapshot.ref);
              const payload = {
                albumWatermark: {
                  url,
                  path: storagePath,
                  name: file.name,
                  position: albumWatermark?.position || 'bottom-right',
                  offsetX: albumWatermark?.offsetX || 0,
                  offsetY: albumWatermark?.offsetY || 0
                }
              };
              await setDoc(doc(db, 'settings', 'global'), payload, { merge: true });
              alert("Watermark-ul pentru albume a fost salvat!");
              resolve();
            } catch (urlErr) {
              reject(urlErr);
            }
          }
        );
      });
    } catch (err: any) {
      console.error("Error uploading album watermark:", err);
      alert(`Încărcarea watermark-ului a eșuat: ${err.message || err.toString()}`);
    } finally {
      setIsUploadingAlbumWatermark(false);
      setAlbumWatermarkUploadProgress(null);
      if (e.target) e.target.value = ''; // clear input
    }
  };

  const handleAlbumWatermarkDelete = async () => {
    if (!albumWatermark) return;
    if (!window.confirm("Ești sigur că vrei să ștergi watermark-ul pentru albume?")) return;

    try {
      try {
        await deleteObject(ref(storage, albumWatermark.path));
      } catch (storageErr) {
        console.warn("Storage delete watermark warning:", storageErr);
      }

      await setDoc(doc(db, 'settings', 'global'), { albumWatermark: null }, { merge: true });
      alert("Watermark-ul pentru albume a fost șters!");
    } catch (err: any) {
      console.error("Error deleting album watermark:", err);
      alert(`Ștergerea watermark-ului a eșuat: ${err.message || err.toString()}`);
    }
  };



  const handleDeleteGallery = (gallery: any) => {
    if (!window.confirm(`Ești sigur că vrei să ștergi galeria "${gallery.title}"? Această acțiune va șterge toate pozele asociate din baza de date și din spațiul de stocare.`)) {
      return;
    }

    // Instantly hide from UI screen
    setDeletingGalleryIds(prev => new Set(prev).add(gallery.id));
    setPhotoGalleries(prev => prev.filter(g => g.id !== gallery.id));

    // Perform deep background deletion without blocking UI or showing any secondary alert
    (async () => {
      try {
        // 1. Delete main Firestore document first
        await deleteDoc(doc(db, 'photo_galleries', gallery.id));

        // 2. Delete Cover from Storage
        if (gallery.coverPhoto?.path) {
          try { await deleteObject(ref(storage, gallery.coverPhoto.path)); } catch {}
        }

        // 3. Delete Photos from Storage + Firestore subcollections
        for (const sub of (gallery.subCollections || [])) {
          let photoDocs: any[] = [];
          try {
            const snap = await getDocs(
              collection(db, 'photo_galleries', gallery.id, 'subcollections', sub.id, 'photos')
            );
            photoDocs = snap.docs;
          } catch {}

          for (const photo of (sub.photos || [])) {
            try { await deleteObject(ref(storage, photo.path)); } catch {}
            if (photo.cleanPath && photo.cleanPath !== photo.path) {
              try { await deleteObject(ref(storage, photo.cleanPath)); } catch {}
            }
          }

          for (const photoDoc of photoDocs) {
            const photoData = photoDoc.data();
            try { await deleteObject(ref(storage, photoData.path)); } catch {}
            if (photoData.cleanPath && photoData.cleanPath !== photoData.path) {
              try { await deleteObject(ref(storage, photoData.cleanPath)); } catch {}
            }
            try { await deleteDoc(photoDoc.ref); } catch {}
          }

          try {
            await deleteDoc(doc(db, 'photo_galleries', gallery.id, 'subcollections', sub.id));
          } catch {}
        }

        // 4. Delete selection links for this gallery
        try {
          const linksSnap = await getDocs(query(collection(db, 'gallery_selection_links'), where('galleryId', '==', gallery.id)));
          for (const linkDoc of linksSnap.docs) {
            try { await deleteDoc(linkDoc.ref); } catch {}
          }
        } catch {}
      } catch (err: any) {
        console.error('Background error deleting gallery:', err);
      } finally {
        setDeletingGalleryIds(prev => {
          const next = new Set(prev);
          next.delete(gallery.id);
          return next;
        });
      }
    })();
  };

  const handleExecuteDuplicate = async (gallery: any, quick: boolean) => {
    setIsDuplicating(true);
    
    const options = quick 
      ? { cover: true, settings: true, folders: true, photos: true }
      : duplicateOptions;
      
    // Count total files to copy
    let totalFiles = 0;
    if (options.cover && gallery.coverPhoto) totalFiles++;
    if (options.folders && options.photos) {
      gallery.subCollections?.forEach((sub: any) => {
        totalFiles += (sub.photos?.length || 0) * 2; // each photo has clean + wm versions
      });
    }
    
    setDuplicateProgress({ current: 0, total: totalFiles });
    let currentProcessed = 0;
    
    try {
      const newGalleryId = doc(collection(db, 'photo_galleries')).id;
      
      const newPayload: any = {
        title: `${gallery.title || 'Galerie fără titlu'} - Copy`,
        subtitle: gallery.subtitle || '',
        date: gallery.date || new Date().toISOString().split('T')[0],
        coverPhoto: null,
        titleStyle: options.settings ? (gallery.titleStyle || {
          fontFamily: 'Outfit',
          fontSize: '42px',
          color: '#FAF9F6',
          position: 'bottom-left'
        }) : {
          fontFamily: 'Outfit',
          fontSize: '42px',
          color: '#FAF9F6',
          position: 'bottom-left'
        },
        watermarkEnabled: options.settings ? (gallery.watermarkEnabled || false) : false,
        watermarkPosition: options.settings ? (gallery.watermarkPosition || 'bottom-right') : 'bottom-right',
        watermarkOffsetX: options.settings ? (gallery.watermarkOffsetX || 0) : 0,
        watermarkOffsetY: options.settings ? (gallery.watermarkOffsetY || 0) : 0,
        selectionEnabled: options.settings ? (gallery.selectionEnabled || false) : false,
        selectionMinPhotos: options.settings ? (gallery.selectionMinPhotos || 0) : 0,
        selectionMaxPhotos: options.settings ? (gallery.selectionMaxPhotos || 0) : 0,
        subCollections: [],
        createdAt: new Date(),
        displayOrder: (() => {
          const min = photoGalleries.reduce((m: number, g: any) =>
            typeof g.displayOrder === 'number' ? Math.min(m, g.displayOrder) : m,
            Infinity
          );
          return isFinite(min) ? min - 1 : 0;
        })()
      };
      
      // Helper: fetch a URL and re-upload it, returns { url, path }
      const copyFile = async (sourceUrl: string, destPath: string) => {
        const res = await fetch(sourceUrl);
        const blob = await res.blob();
        const storageRef = ref(storage, destPath);
        await uploadBytesResumable(storageRef, blob);
        const url = await getDownloadURL(storageRef);
        return { url, path: destPath };
      };

      // 1. Copy Cover
      if (options.cover && gallery.coverPhoto) {
        try {
          const newCoverPath = `galleries/${newGalleryId}/cover_${Date.now()}_cover.jpg`;
          const { url } = await copyFile(gallery.coverPhoto.url, newCoverPath);
          newPayload.coverPhoto = {
            url,
            path: newCoverPath,
            bw: gallery.coverPhoto.bw || false,
            focalPoint: gallery.coverPhoto.focalPoint || { x: 50, y: 50 }
          };
        } catch (coverErr) {
          console.error("Error copying cover during duplicate:", coverErr);
        }
        currentProcessed++;
        setDuplicateProgress({ current: currentProcessed, total: totalFiles });
      }
      
      // 2. Copy Subcollections
      if (options.folders) {
        const subCollectionsList = gallery.subCollections || [];
        const newSubsMeta: any[] = [];

        for (const sub of subCollectionsList) {
          newSubsMeta.push({ id: sub.id, name: sub.name });

          if (options.photos) {
            // Fetch photos from the source gallery's subcollection
            let sourcePhotos: any[] = [];
            try {
              const sourceSnap = await getDocs(
                collection(db, 'photo_galleries', gallery.id, 'subcollections', sub.id, 'photos')
              );
              sourcePhotos = sourceSnap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
            } catch {}

            // Also include embedded photos (legacy)
            const legacyPhotos = (sub.photos || []).filter(
              (p: any) => !sourcePhotos.some((sp: any) => sp.path === p.path)
            );
            const allPhotos = [...sourcePhotos, ...legacyPhotos];

            totalFiles += allPhotos.length * 2;
            setDuplicateProgress({ current: 0, total: totalFiles });

            for (const photo of allPhotos) {
              try {
                const photoEntry: any = {
                  name: photo.name,
                  width: photo.width || null,
                  height: photo.height || null,
                  order: null,
                };

                if (photo.url) {
                  const newPhotoPath = `galleries/${newGalleryId}/${sub.id}/wm_${Date.now()}_${photo.name}`;
                  const { url } = await copyFile(photo.url, newPhotoPath);
                  photoEntry.url = url;
                  photoEntry.path = newPhotoPath;
                  currentProcessed++;
                  setDuplicateProgress({ current: currentProcessed, total: totalFiles });
                }

                if (photo.cleanUrl) {
                  const newCleanPath = `galleries/${newGalleryId}/${sub.id}/clean_${Date.now()}_${photo.name}`;
                  const { url: cleanUrl } = await copyFile(photo.cleanUrl, newCleanPath);
                  photoEntry.cleanUrl = cleanUrl;
                  photoEntry.cleanPath = newCleanPath;
                  currentProcessed++;
                  setDuplicateProgress({ current: currentProcessed, total: totalFiles });
                }

                // Write photo to new gallery's subcollection directly
                await addDoc(
                  collection(db, 'photo_galleries', newGalleryId, 'subcollections', sub.id, 'photos'),
                  photoEntry
                );
              } catch (photoErr) {
                console.error('Error copying photo during duplicate:', photo.name, photoErr);
              }
            }
          }
        }

        newPayload.subCollections = newSubsMeta;
      } else {
        // If not copying folders, create a default folder
        newPayload.subCollections = [{ id: 'all', name: 'General' }];
      }

      // 3. Save main document to Firestore (no photos embedded)
      await setDoc(doc(db, 'photo_galleries', newGalleryId), newPayload);
      alert('Galeria a fost duplicată cu succes!');
      setDuplicatingGallery(null);
    } catch (err) {
      console.error("Error duplicating gallery:", err);
      alert('Duplicarea galeriei a eșuat.');
    } finally {
      setIsDuplicating(false);
    }
  };


  const handleExecuteCreateGallery = async () => {
    const titleClean = newGalleryTitle.trim();
    if (!titleClean) {
      alert('Numele galeriei este obligatoriu.');
      return;
    }
    
    setIsCreatingGallery(true);
    
    try {
      const minDisplayOrder = photoGalleries.reduce((m: number, g: any) =>
        typeof g.displayOrder === 'number' ? Math.min(m, g.displayOrder) : m,
        Infinity
      );
      const payload = {
        title: titleClean,
        subtitle: newGallerySubtitle.trim(),
        date: newGalleryDate,
        coverPhoto: null,
        titleStyle: {
          fontFamily: 'Outfit',
          fontSize: '42px',
          color: '#FAF9F6',
          position: 'bottom-left'
        },
        watermarkEnabled: newGalleryWatermark,
        watermarkPosition: 'bottom-right',
        subCollections: [{ id: 'all', name: 'General' }],  // no photos[] embedded
        createdAt: new Date(),
        displayOrder: isFinite(minDisplayOrder) ? minDisplayOrder - 1 : 0
      };
      
      const docRef = await addDoc(collection(db, 'photo_galleries'), payload);
      
      // Reset state
      setShowCreateGalleryModal(false);
      setNewGalleryTitle('');
      setNewGallerySubtitle('');
      setNewGalleryDate(new Date().toISOString().split('T')[0]);
      setNewGalleryWatermark(false);
      
      // Redirect to the editor!
      navigate(`/admin/edit-photo-gallery/${docRef.id}`);
    } catch (err) {
      console.error("Error creating new gallery:", err);
      alert("Crearea galeriei a eșuat.");
    } finally {
      setIsCreatingGallery(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    
    setIsUploadingAvatar(true);
    setAvatarUploadProgress(0);
    
    const storagePath = `settings/photographer_avatar_${Date.now()}_${file.name}`;
    const storageRef = ref(storage, storagePath);
    
    // Delete old avatar if it exists
    if (photographerProfile?.avatarPath) {
      try {
        await deleteObject(ref(storage, photographerProfile.avatarPath));
      } catch (oldErr) {
        console.warn("Could not delete old avatar file:", oldErr);
      }
    }
    
    const uploadTask = uploadBytesResumable(storageRef, file);
    
    uploadTask.on(
      'state_changed',
      (snapshot) => {
        const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
        setAvatarUploadProgress(progress);
      },
      (error) => {
        console.error("Avatar upload error:", error);
        alert("Încărcarea pozei de profil a eșuat.");
        setIsUploadingAvatar(false);
        setAvatarUploadProgress(null);
      },
      async () => {
        try {
          const url = await getDownloadURL(uploadTask.snapshot.ref);
          
          const updatedProfile = {
            name: profileNameInput.trim() || photographerProfile?.name || 'ALEXIA VISUAL ARTIST',
            link: profileLinkInput.trim() || photographerProfile?.link || '',
            avatarUrl: url,
            avatarPath: storagePath
          };
          
          await setDoc(doc(db, 'settings', 'global'), {
            photographerProfile: updatedProfile
          }, { merge: true });
          
          alert("Poza de profil a fost încărcată cu succes!");
        } catch (err) {
          console.error("Error saving avatar URL:", err);
          alert("Salvarea informațiilor despre avatar a eșuat.");
        } finally {
          setIsUploadingAvatar(false);
          setAvatarUploadProgress(null);
        }
      }
    );
  };

  const handleSaveProfile = async () => {
    try {
      const nameClean = profileNameInput.trim();
      const linkClean = profileLinkInput.trim();
      
      const updatedProfile = {
        name: nameClean || 'ALEXIA VISUAL ARTIST',
        link: linkClean,
        avatarUrl: photographerProfile?.avatarUrl || '',
        avatarPath: photographerProfile?.avatarPath || ''
      };
      
      await setDoc(doc(db, 'settings', 'global'), {
        photographerProfile: updatedProfile
      }, { merge: true });
      
      alert("Profilul fotografului a fost salvat cu succes!");
    } catch (err) {
      console.error("Error saving profile details:", err);
      alert("Salvarea profilului a eșuat.");
    }
  };

  const copyToClipboard = (text: string, id: string, type: 'config' | 'gallery' | 'public_gallery' | 'gallery_clean' | 'gsheet') => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId({ id, type });
      setTimeout(() => setCopiedId(null), 2000);
    });
  };


  const getSubmissionsCount = (classId: string) => {
    return Object.values(submissions).filter(sub => sub.classId === classId).length;
  };

  /** Flip one boolean feature flag on a class (replaces seven copy-pasted handlers). */
  const setClassFlag = async (classId: string, key: string, value: boolean) => {
    try {
      await updateDoc(doc(db, 'classes', classId), { [key]: value });
      setClasses(prev => prev.map(c => c.id === classId ? { ...c, [key]: value } : c));
    } catch (err) {
      console.error('Error updating class setting:', key, err);
      alert('Eroare la actualizarea setării.');
    }
  };

  const deadlineOf = (cls: ClassData): Date | null =>
    cls.deadline?.toDate ? cls.deadline.toDate() : null;

  /** Everything the class list needs to render one row, derived from existing data. */
  const classProgress = (cls: ClassData) => {
    const total = cls.studentList?.length || 0;
    const done = getSubmissionsCount(cls.id);
    const deadline = deadlineOf(cls);
    const isLate = !!deadline && new Date() > deadline;
    const daysLeft = deadline
      ? Math.ceil((deadline.getTime() - Date.now()) / 86400000)
      : null;
    return {
      total,
      done,
      deadline,
      isLate,
      daysLeft,
      pct: total ? Math.min(100, Math.round((done / total) * 100)) : 0,
      isComplete: total > 0 && done >= total,
    };
  };

  return (
    <AdminLayout
      mainMaxWidth={1400}
      center={
        <>
          <button
            className={`nav-link ${activeTab === 'classes' ? 'active' : ''}`}
            onClick={() => navigate('/admin/dashboard/classes')}
          >
            Albume absolvenți
          </button>
          <button
            className={`nav-link ${activeTab === 'galleries' ? 'active' : ''}`}
            onClick={() => navigate('/admin/dashboard/galleries')}
          >
            Galerii foto
          </button>
          <button
            className={`nav-link ${activeTab === 'watermark' ? 'active' : ''}`}
            onClick={() => navigate('/admin/dashboard/watermark')}
          >
            Watermark & profil
          </button>
        </>
      }
      actions={
        <button className="logout-btn" onClick={handleLogout}>
          <LogOut size={16} /> Deconectare
        </button>
      }
    >
      {/* Main Content */}
      {error ? (
          <div className="dashboard-error">
            <AlertCircle size={48} className="text-danger" />
            <h3>Eroare conectare Firestore</h3>
            <p className="error-desc">{error}</p>
            <p className="error-help">
              Asigură-te că baza de date Cloud Firestore este activată în consola Firebase și că regulile de securitate permit accesul.
            </p>
            <button className="btn btn-secondary" onClick={() => window.location.reload()}>
              Reîncearcă
            </button>
          </div>
        ) : loading ? (
          <div className="dashboard-loading">
            <RefreshCw className="spinner" size={32} />
            <p>Se încarcă datele...</p>
          </div>
        ) : activeTab === 'classes' ? (
          <div className="dashboard-section">
            
            {selectedClass ? (
              /* DRILL DOWN: CLASS DIRECTORY VIEW */
              <div className="directory-view animate-fade">
                {/* Breadcrumbs & Navigation */}
                <div className="directory-breadcrumbs-row">
                  <div className="breadcrumbs">
                    <button className="breadcrumb-btn" onClick={() => navigate('/admin/dashboard/classes')}>
                      <ArrowLeft size={13} strokeWidth={1.4} /> Toate clasele
                    </button>
                    <ChevronRight size={12} strokeWidth={1.5} className="breadcrumb-separator" />
                    <span className="breadcrumb-current">{selectedClass.schoolName}</span>
                  </div>
                </div>

                {/* Class Manager Info & Settings Block */}
                <div className="class-settings-card">
                  <div className="card-top-header">
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '11px', flexWrap: 'wrap' }}>
                        <h2 style={{ margin: 0 }}>{selectedClass.schoolName}</h2>
                        {selectedClass.status === 'active' ? (
                          <span className="ad-chip ad-chip-ok">
                            <span style={{ width: '5px', height: '5px', borderRadius: '999px', background: 'var(--st-ok)' }} />
                            Configurator activ
                          </span>
                        ) : (
                          <span className="ad-chip ad-chip-mute">Configurator blocat</span>
                        )}
                        {selectedClass.deadline && new Date() > selectedClass.deadline.toDate() && (
                          <span className="ad-chip ad-chip-bad">Termen depășit</span>
                        )}
                      </div>
                      <p className="subtitle-teacher ad-num" style={{ marginTop: '6px' }}>
                        {selectedClass.diriginteName}
                        {(() => {
                          const p = classProgress(selectedClass);
                          if (!p.deadline) return null;
                          return ` · termen ${p.deadline.toLocaleDateString('ro-RO')}${p.isLate ? '' : ` · ${p.daysLeft} zile rămase`}`;
                        })()}
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: '7px', alignItems: 'center' }}>
                      <button
                        onClick={() => setActiveChecklistModal({
                          type: 'class',
                          id: selectedClass.id,
                          title: selectedClass.schoolName,
                          subtitle: `Diriginte: ${selectedClass.diriginteName}`,
                          items: selectedClass.checklist || []
                        })}
                        className="ad-btn ad-btn-quiet"
                      >
                        <CheckSquare size={13} strokeWidth={1.4} style={{ color: 'var(--a-data)' }} />
                        Checklist ({ (selectedClass.checklist || []).filter((c: any) => c.completed).length }/{ (selectedClass.checklist || []).length })
                      </button>

                      <span className="ad-head-divider" aria-hidden="true" />

                      <button
                        className="ad-btn ad-btn-quiet"
                        style={{ padding: '5px 5px 5px 13px' }}
                        onClick={async () => {
                          const { generateClassExcel } = await import('../../utils/excelExporter');
                          generateClassExcel(selectedClass, submissions);
                        }}
                      >
                        Descarcă Excel
                        <span style={{ width: '24px', height: '24px', borderRadius: '7px', backgroundColor: 'var(--a-data)', color: '#131211', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Download size={12} strokeWidth={1.8} />
                        </span>
                      </button>
                      <button
                        className="ad-icon-btn"
                        onClick={handleOpenEditClassParams}
                        title="Editează prețuri și limite"
                        aria-label="Editează prețuri și limite"
                      >
                        <Edit size={14} strokeWidth={1.4} />
                      </button>
                      <button
                        className="ad-icon-btn"
                        onClick={() => toggleClassStatus(selectedClass.id, selectedClass.status)}
                        title={selectedClass.status === 'active' ? 'Blochează configuratorul' : 'Activează configuratorul'}
                        aria-label={selectedClass.status === 'active' ? 'Blochează configuratorul' : 'Activează configuratorul'}
                      >
                        {selectedClass.status === 'active'
                          ? <Lock size={14} strokeWidth={1.4} />
                          : <Unlock size={14} strokeWidth={1.4} />}
                      </button>
                      <button
                        className="ad-icon-btn ad-icon-btn-danger"
                        onClick={() => deleteClass(selectedClass.id)}
                        title="Șterge clasa"
                        aria-label="Șterge clasa"
                      >
                        <Trash2 size={14} strokeWidth={1.4} />
                      </button>
                    </div>
                  </div>

                  <div className="class-links-row">
                    {[
                      { label: 'Configurator elevi', url: `${window.location.origin}/class/${selectedClass.id}`, type: 'config' as const, canOpen: true },
                      { label: 'Galerie foto finală', url: `${window.location.origin}/gallery/${selectedClass.id}`, type: 'gallery' as const, canOpen: true },
                      { label: 'Editare (fără watermark)', url: `${window.location.origin}/gallery/${selectedClass.id}/clean`, type: 'gallery_clean' as const, canOpen: false },
                      { label: 'Document confirmare', url: `${window.location.origin}/sheet/${selectedClass.id}`, type: 'gsheet' as const, canOpen: true },
                    ].map(link => {
                      const isCopied = copiedId?.id === selectedClass.id && copiedId?.type === link.type;
                      return (
                        <div key={link.type} className="link-field-wrapper">
                          <span className="field-label-text">{link.label}</span>
                          <div className="field-input-row">
                            <input type="text" readOnly className="link-input-display" value={link.url} />
                            <button
                              className="action-icon-btn"
                              title={`Copiază linkul: ${link.label}`}
                              aria-label={`Copiază linkul: ${link.label}`}
                              onClick={() => copyToClipboard(link.url, selectedClass.id, link.type)}
                            >
                              {isCopied
                                ? <Check size={13} strokeWidth={1.8} className="text-success" />
                                : <Copy size={13} strokeWidth={1.4} />}
                            </button>
                            {link.canOpen && (
                              <a
                                href={link.url}
                                target="_blank"
                                rel="noreferrer"
                                className="action-icon-btn"
                                title="Deschide într-o filă nouă"
                                aria-label="Deschide într-o filă nouă"
                              >
                                <ExternalLink size={13} strokeWidth={1.4} />
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="class-body-grid">
                  <aside className="class-rail">

                    {(() => {
                      const flags = [
                        { key: 'albumTypesEnabled', label: 'Tipuri de album', meta: `${selectedClass.priceAlbumMare ?? 150} / ${selectedClass.priceAlbumMic ?? 100} lei`, on: selectedClass.albumTypesEnabled !== false },
                        { key: 'enableSonete', label: 'Sonete', meta: `${selectedClass.priceSonet ?? 25} lei`, on: selectedClass.enableSonete !== false },
                        { key: 'enableVoiceMessage', label: 'Mesaj vocal', meta: 'cu QR', on: !!selectedClass.enableVoiceMessage },
                        { key: 'enablePoster', label: 'Poster', meta: '', on: selectedClass.enablePoster !== false },
                        { key: 'enableExtraItems', label: 'Cumpărături extra', meta: '', on: selectedClass.enableExtraItems !== false },
                        { key: 'enableObservatii', label: 'Observații', meta: '', on: selectedClass.enableObservatii !== false },
                        { key: 'requireEmailDownload', label: 'Email la descărcare', meta: '', on: !!selectedClass.requireEmailDownload },
                      ];
                      const onCount = flags.filter(f => f.on).length;

                      return (
                        <div className="ad-frame">
                          <div className="ad-core" style={{ padding: '15px 16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                              <span style={{ fontSize: '12.5px', fontWeight: 600 }}>Ce pot alege elevii</span>
                              <span className="ad-num" style={{ fontSize: '11px', color: 'var(--t-muted)' }}>{onCount} / {flags.length}</span>
                            </div>
                            <div className="ad-toggle-list">
                              {flags.map(f => (
                                <label key={f.key} className={`ad-toggle-row${f.on ? ' is-on' : ''}`}>
                                  <input
                                    type="checkbox"
                                    checked={f.on}
                                    onChange={(e) => setClassFlag(selectedClass.id, f.key, e.target.checked)}
                                  />
                                  <span className="ad-switch" aria-hidden="true" />
                                  <span className="ad-toggle-label">{f.label}</span>
                                  {f.meta && <span className="ad-num ad-toggle-meta">{f.meta}</span>}
                                </label>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    <div className="ad-frame">
                      <div className="ad-core" style={{ padding: '15px 16px' }}>
                        <span style={{ fontSize: '12.5px', fontWeight: 600, display: 'block', marginBottom: '10px' }}>Prețuri &amp; limite</span>
                        <dl className="ad-spec">
                          <div><dt>Pagină extra</dt><dd className="ad-num">{selectedClass.extraPagesPrice ?? 0} lei</dd></div>
                          <div><dt>Album mare</dt><dd className="ad-num">{selectedClass.priceAlbumMare ?? 150} lei</dd></div>
                          <div><dt>Album mic</dt><dd className="ad-num">{selectedClass.priceAlbumMic ?? 100} lei</dd></div>
                          <div><dt>Sonet</dt><dd className="ad-num">{selectedClass.priceSonet ?? 25} lei</dd></div>
                          <div><dt>Poze personale</dt><dd className="ad-num">{selectedClass.minPhotos ?? selectedClass.minPhotosAlbumMare ?? 4}–{selectedClass.maxPhotos ?? selectedClass.maxPhotosAlbumMare ?? 20}</dd></div>
                          <div><dt>Termen limită</dt><dd className="ad-num">{selectedClass.deadline ? selectedClass.deadline.toDate().toLocaleDateString('ro-RO') : 'fără termen'}</dd></div>
                        </dl>
                      </div>
                    </div>

                {/* Gallery Management section */}
                <div className="ad-frame">
                <div className="ad-core student-dossiers-wrapper" style={{ padding: '15px 16px' }}>
                  <div className="dossiers-header-row">
                    <h3 style={{ fontSize: '12.5px' }}>
                      Galeria clasei
                    </h3>
                    <span className="ad-num" style={{ fontSize: '11px', color: 'var(--t-muted)' }}>
                      {(selectedClass.galleryPhotos || []).length} poze
                    </span>
                  </div>

                  {showAddPhotosForm && (
                    <div style={{ padding: '24px', backgroundColor: '#1C1A19', borderBottom: '1px solid #262423', borderTop: '1px solid #262423' }}>
                      {albumWatermark && (
                        <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#0E0D0C', padding: '12px', borderRadius: '4px', border: '1px solid #2D2A28' }}>
                          <input 
                            type="checkbox" 
                            id="apply-album-watermark-toggle-dash"
                            checked={applyAlbumWatermarkToggle} 
                            onChange={(e) => setApplyAlbumWatermarkToggle(e.target.checked)} 
                            style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: 'var(--gold-accent)' }}
                          />
                          <label htmlFor="apply-album-watermark-toggle-dash" style={{ margin: 0, fontSize: '13px', color: '#FAF9F6', cursor: 'pointer', fontWeight: 500 }}>
                            Aplică Watermark Album pe pozele adăugate
                          </label>
                        </div>
                      )}
                      <div className="upload-dropzone" style={{ border: '2px dashed #2D2A28', padding: '32px', textAlign: 'center', borderRadius: '6px', cursor: 'pointer', position: 'relative' }}>
                        {selectedClass.galleryType === 'folder' ? (
                          <input 
                            type="file" 
                            multiple 
                            {...({ webkitdirectory: '', directory: '' } as any)}
                            onChange={handleNewFilesUpload}
                            id="add-photos-input"
                            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
                          />
                        ) : (
                          <input 
                            type="file" 
                            multiple 
                            accept="image/*"
                            onChange={handleNewFilesUpload}
                            id="add-photos-input"
                            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
                          />
                        )}
                        <FolderOpen size={32} style={{ color: 'var(--gold-accent)', marginBottom: '8px' }} />
                        <h4 style={{ color: '#FAF9F6', margin: '4px 0', fontSize: '14px' }}>
                          {selectedClass.galleryType === 'folder' ? 'Faceți click pentru a alege folderul de adăugat' : 'Faceți click pentru a alege poze de adăugat'}
                        </h4>
                        <p style={{ color: '#706E6A', fontSize: '12px' }}>
                          {selectedClass.galleryType === 'folder' ? 'Se vor încărca pozele structurate în subfoldere' : 'Sunt acceptate imagini JPG, PNG'}
                        </p>
                      </div>
                    </div>
                  )}

                  {(() => {
                    const photos = selectedClass.galleryPhotos || [];

                    if (photos.length === 0) {
                      return (
                        <div className="ad-gallery-empty">
                          <ImageIcon size={17} strokeWidth={1.4} />
                          <span>Nicio poză încărcată</span>
                        </div>
                      );
                    }

                    const photoKey = (p: any) => p.path || p.url || p.name;

                    const renderCell = (photo: any) => {
                      const key = photoKey(photo);
                      const isDeleting = isDeletingPhoto === key;
                      return (
                        <div key={key} className="ad-photo-cell" title={photo.folder ? `${photo.folder} / ${photo.name}` : photo.name}>
                          <img
                            src={photo.previewUrl || photo.url || photo.cleanUrl || photo.previewCleanUrl || ''}
                            alt={photo.name}
                            loading="lazy"
                            onError={(e) => { (e.target as HTMLElement).style.visibility = 'hidden'; }}
                          />
                          <button
                            type="button"
                            className="ad-photo-del"
                            onClick={() => handleDeletePhoto(photo)}
                            disabled={isDeleting}
                            title={`Șterge ${photo.name}`}
                            aria-label={`Șterge ${photo.name}`}
                          >
                            {isDeleting
                              ? <RefreshCw className="spinner" size={11} style={{ animation: 'spin 1s linear infinite' }} />
                              : <X size={11} strokeWidth={2.2} />}
                          </button>
                        </div>
                      );
                    };

                    // Collapsed: a five-photo preview plus an overflow tile.
                    if (!showAllClassPhotos) {
                      const PREVIEW = 5;
                      const overflow = photos.length - PREVIEW;
                      return (
                        <>
                          <div className="ad-photo-grid">
                            {photos.slice(0, PREVIEW).map(renderCell)}
                            {overflow > 0 && (
                              <button
                                type="button"
                                className="ad-photo-more"
                                onClick={() => setShowAllClassPhotos(true)}
                                title="Vezi toate pozele"
                              >
                                +{overflow}
                              </button>
                            )}
                          </div>
                        </>
                      );
                    }

                    // Expanded: everything, grouped by folder when the class uses folders.
                    if (selectedClass.galleryType === 'folder') {
                      const groups: Record<string, any[]> = {};
                      photos.forEach(p => {
                        const f = p.folder || 'Fără folder';
                        if (!groups[f]) groups[f] = [];
                        groups[f].push(p);
                      });

                      return (
                        <>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                            {Object.entries(groups).map(([folderName, folderPhotos]) => (
                              <div key={folderName}>
                                <div className="ad-photo-folder-head">
                                  <Folder size={12} strokeWidth={1.4} />
                                  <span>{folderName}</span>
                                  <span className="ad-num">{folderPhotos.length}</span>
                                </div>
                                <div className="ad-photo-grid">
                                  {folderPhotos.map(renderCell)}
                                </div>
                              </div>
                            ))}
                          </div>
                          <button type="button" className="ad-photo-less" onClick={() => setShowAllClassPhotos(false)}>
                            Arată mai puțin
                          </button>
                        </>
                      );
                    }

                    return (
                      <>
                        <div className="ad-photo-grid">
                          {photos.map(renderCell)}
                        </div>
                        <button type="button" className="ad-photo-less" onClick={() => setShowAllClassPhotos(false)}>
                          Arată mai puțin
                        </button>
                      </>
                    );
                  })()}

                  <button
                    type="button"
                    className="ad-upload-btn"
                    onClick={() => setShowAddPhotosForm(!showAddPhotosForm)}
                  >
                    <Upload size={13} strokeWidth={1.4} />
                    {showAddPhotosForm ? 'Închide încărcarea' : 'Încarcă poze'}
                  </button>
                </div>
                </div>

                  </aside>

                  <div className="class-main">
                {/* Submissions Folder Structure section */}
                <div className="student-dossiers-wrapper">
                  <div className="dossiers-header-row">
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                      <h3>Dosarele elevilor</h3>
                      <span className="ad-num" style={{ fontSize: '11.5px', color: 'var(--t-muted)' }}>
                        {getSubmissionsCount(selectedClass.id)} din {(selectedClass.studentList || []).length} trimise
                      </span>
                    </div>

                    <div className="header-actions-row" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <label className="ad-search" style={{ width: '190px' }}>
                        <Search size={13} strokeWidth={1.4} color="var(--t-muted)" />
                        <input
                          type="text"
                          placeholder="Caută elev"
                          value={searchStudentQuery}
                          onChange={(e) => setSearchStudentQuery(e.target.value)}
                        />
                      </label>

                      {getSubmissionsCount(selectedClass.id) > 0 && (
                        <button
                          className="ad-btn ad-btn-quiet"
                          onClick={downloadClassZip}
                          disabled={classZipProgress !== null}
                          style={{ padding: '5px 5px 5px 13px', opacity: classZipProgress !== null ? 0.6 : 1 }}
                        >
                          {classZipProgress !== null ? `Se descarcă ${classZipProgress}%` : 'Descarcă tot'}
                          <span style={{ width: '23px', height: '23px', borderRadius: '7px', background: 'rgba(243,237,231,0.09)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Download size={12} strokeWidth={1.6} />
                          </span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="explorer-list">
                    {(() => {
                      const classSubmissions = Object.values(submissions).filter(sub => sub.classId === selectedClass.id);
                      
                      let dossiers: { name: string; hasSubmitted: boolean; submissionData: any }[] = [];
                      
                      if (selectedClass.studentList && selectedClass.studentList.length > 0) {
                        dossiers = selectedClass.studentList
                          .filter(name => name.toLowerCase().includes(searchStudentQuery.toLowerCase()))
                          .sort((a, b) => a.localeCompare(b))
                          .map(name => {
                            const sub = classSubmissions.find(s => s.studentName.toLowerCase() === name.toLowerCase());
                            return {
                              name,
                              hasSubmitted: !!sub,
                              submissionData: sub || null
                            };
                          });
                      } else {
                        // Fallback to only showing submissions for compatibility with old classes
                        dossiers = classSubmissions
                          .filter(sub => sub.studentName.toLowerCase().includes(searchStudentQuery.toLowerCase()))
                          .sort((a, b) => a.studentName.localeCompare(b.studentName))
                          .map(sub => ({
                            name: sub.studentName,
                            hasSubmitted: true,
                            submissionData: sub
                          }));
                      }

                      if (dossiers.length === 0) {
                        return (
                          <div className="dossier-empty-message" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 20px', backgroundColor: '#1C1A19', border: '1px dashed #262423', borderRadius: '6px', width: '100%' }}>
                            <AlertCircle size={32} style={{ color: '#706E6A', marginBottom: '12px' }} />
                            <span style={{ color: '#FAF9F6', fontWeight: 500 }}>Niciun dosar găsit</span>
                            <span style={{ color: '#706E6A', fontSize: '12px', marginTop: '4px', textAlign: 'center' }}>
                              Adăugați elevi în lista clasei pentru a le configura automat dosarele.
                            </span>
                          </div>
                        );
                      }

                      return (
                        <div className="ad-frame" style={{ width: '100%' }}>
                          {dossiers.map(({ name, hasSubmitted, submissionData }) => {
                            const isExpanded = expandedStudent === name;
                            const isDownloading = studentZipProgress[name] !== undefined;
                            const initials = name.trim().split(/\s+/).slice(0, 2).map(w => w.charAt(0)).join('').toUpperCase();
                            const hasVoice = !!submissionData?.voiceMessageUrl;

                            return (
                              <div key={name} className={`explorer-row-item ${isExpanded ? 'expanded' : ''} ${hasSubmitted ? 'submitted' : 'pending'}`}>
                                {/* Row Header */}
                                <div
                                  className="explorer-row-header"
                                  onClick={() => navigate(isExpanded
                                    ? `/admin/dashboard/classes/${selectedClass.id}`
                                    : `/admin/dashboard/classes/${selectedClass.id}/students/${encodeURIComponent(name)}`)}
                                >
                                  <div className="explorer-item-title-section">
                                    {isExpanded ? (
                                      <ChevronDown size={13} strokeWidth={1.7} className="arrow-exp" />
                                    ) : (
                                      <ChevronRight size={13} strokeWidth={1.7} className="arrow-exp" />
                                    )}

                                    <span className={`ad-avatar${hasSubmitted ? '' : ' is-pending'}`}>{initials}</span>

                                    <span className="explorer-student-name" style={{ color: hasSubmitted ? 'var(--t-hi)' : 'var(--t-muted)' }}>{name}</span>
                                  </div>

                                  <div className="explorer-item-badges">
                                    {hasVoice && (
                                      <span className="ad-chip ad-chip-data" title="Are mesaj vocal">
                                        <Mic size={11} strokeWidth={1.5} /> vocal
                                      </span>
                                    )}
                                    {hasSubmitted && submissionData.extraPagesEnabled && (
                                      <span className="extra-pages-badge">Extra pagini</span>
                                    )}
                                    {hasSubmitted && (
                                      <span className="ad-num ad-row-meta" style={{ minWidth: '132px', textAlign: 'right' }}>
                                        {submissionData.selectedAlbumType === 'mic' ? 'Album mic' : 'Album mare'} · {submissionData.totalCost ?? 0} lei
                                      </span>
                                    )}
                                    {hasSubmitted ? (
                                      <span className="ad-chip ad-chip-ok">Trimis</span>
                                    ) : (
                                      <span className="ad-chip ad-chip-mute">Așteptare</span>
                                    )}
                                  </div>
                                </div>

                                {/* Collapsible Content */}
                                {isExpanded && (
                                  hasSubmitted ? (
                                    <div className="explorer-row-content">
                                      <div className="dossier-inner-grid">
                                        {/* Left side: details files text */}
                                        <div className="dossier-text-pane">
                                          <h5 className="dossier-section-title">Informații și Opțiuni</h5>
                                          
                                          <div className="dossier-meta-item">
                                            <span className="meta-label">Nume dorit pe album:</span>
                                            <span style={{ color: 'var(--gold-accent)', fontWeight: 600 }}>{submissionData.albumName || name}</span>
                                          </div>

                                          <div className="dossier-meta-item">
                                            <span className="meta-label">Tip Album:</span>
                                            <span style={{ textTransform: 'uppercase', fontWeight: 600 }}>{submissionData.selectedAlbumType === 'mic' ? 'Album Mic' : 'Album Mare'}</span>
                                          </div>

                                          <div className="dossier-meta-item">
                                            <span className="meta-label">Cost Total:</span>
                                            <span style={{ color: 'var(--gold-accent)', fontWeight: 700 }}>{submissionData.totalCost ?? 0} RON</span>
                                          </div>

                                          <div className="dossier-meta-item">
                                            <span className="meta-label">Dată trimitere:</span>
                                            <span>{submissionData.submittedAt?.toDate ? submissionData.submittedAt.toDate().toLocaleString('ro-RO') : 'N/A'}</span>
                                          </div>

                                          {submissionData.citat && (
                                            <div className="dossier-meta-text-block">
                                              <span className="meta-label">Citat album:</span>
                                              <p className="citat-p-explore">„{submissionData.citat}”</p>
                                            </div>
                                          )}

                                          {submissionData.citatSonet && (
                                            <div className="dossier-meta-text-block" style={{ marginTop: '8px' }}>
                                              <span className="meta-label">Citat sonet:</span>
                                              <p className="citat-p-explore" style={{ color: '#E5C158' }}>„{submissionData.citatSonet}”</p>
                                            </div>
                                          )}

                                          {submissionData.observatii && (
                                            <div className="dossier-meta-text-block" style={{ marginTop: '8px' }}>
                                              <span className="meta-label">Observații designer:</span>
                                              <p className="observatii-p-explore">{submissionData.observatii}</p>
                                            </div>
                                          )}

                                          {submissionData.extraItemsText && (
                                            <div className="dossier-meta-text-block" style={{ marginTop: '8px' }}>
                                              <span className="meta-label">Cumpărături Extra:</span>
                                              <p className="observatii-p-explore" style={{ color: 'var(--gold-accent)' }}>{submissionData.extraItemsText}</p>
                                            </div>
                                          )}

                                          <div className="dossier-actions-footer" style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
                                            <button 
                                              className="btn btn-gold btn-explore-action"
                                              onClick={() => setSelectedSubmission({ studentName: name, ...submissionData })}
                                              style={{ padding: '8px 16px', fontSize: '12px' }}
                                            >
                                              <Eye size={14} /> Vizualizează Poze & Detalii
                                            </button>
                                            <button 
                                              className="btn btn-secondary btn-explore-action"
                                              onClick={() => downloadStudentZip(name, submissionData)}
                                              disabled={isDownloading}
                                              style={{ padding: '8px 16px', fontSize: '12px' }}
                                            >
                                              {isDownloading ? (
                                                <>Se descarcă ZIP ({studentZipProgress[name]}%)...</>
                                              ) : (
                                                <><Download size={14} /> Descarcă poze (ZIP)</>
                                              )}
                                            </button>
                                          </div>
                                        </div>

                                        {/* Right side: file structures list */}
                                        <div className="dossier-files-pane">
                                          <h5 className="dossier-section-title">Fișiere Selectate</h5>
                                          
                                          <ul className="dossier-files-list">
                                            {submissionData.copertaPhoto && (
                                              <li className="dossier-file-item">
                                                <File size={14} className="file-icon-type" />
                                                <div className="dossier-file-details">
                                                  <span className="file-category">Copertă:</span>
                                                  <span className="file-name-text" title={submissionData.copertaPhoto.name || 'photo.jpg'}>{submissionData.copertaPhoto.name || 'photo.jpg'}</span>
                                                  <span className={`badge-bw-inline ${submissionData.copertaPhoto.bw ? 'bw' : 'color'}`}>{submissionData.copertaPhoto.bw ? 'Alb-Negru' : 'Color'}</span>
                                                </div>
                                              </li>
                                            )}
                                            {submissionData.colegiPhoto && (
                                              <li className="dossier-file-item">
                                                <File size={14} className="file-icon-type" />
                                                <div className="dossier-file-details">
                                                  <span className="file-category">Colegi:</span>
                                                  <span className="file-name-text" title={submissionData.colegiPhoto.name || 'photo.jpg'}>{submissionData.colegiPhoto.name || 'photo.jpg'}</span>
                                                  <span className={`badge-bw-inline ${submissionData.colegiPhoto.bw ? 'bw' : 'color'}`}>{submissionData.colegiPhoto.bw ? 'Alb-Negru' : 'Color'}</span>
                                                </div>
                                              </li>
                                            )}
                                            {submissionData.posterPhoto && (
                                              <li className="dossier-file-item">
                                                <File size={14} className="file-icon-type" style={{ color: 'var(--gold-accent)' }} />
                                                <div className="dossier-file-details">
                                                  <span className="file-category" style={{ color: 'var(--gold-accent)' }}>Poster:</span>
                                                  <span className="file-name-text" title={submissionData.posterPhoto.name || 'photo.jpg'}>{submissionData.posterPhoto.name || 'photo.jpg'}</span>
                                                  <span className={`badge-bw-inline ${submissionData.posterPhoto.bw ? 'bw' : 'color'}`}>{submissionData.posterPhoto.bw ? 'Alb-Negru' : 'Color'}</span>
                                                </div>
                                              </li>
                                            )}
                                            {submissionData.sonetPhoto && (
                                              <li className="dossier-file-item">
                                                <File size={14} className="file-icon-type" style={{ color: 'var(--gold-accent)' }} />
                                                <div className="dossier-file-details">
                                                  <span className="file-category" style={{ color: 'var(--gold-accent)' }}>Sonet:</span>
                                                  <span className="file-name-text" title={submissionData.sonetPhoto.name || 'photo.jpg'}>{submissionData.sonetPhoto.name || 'photo.jpg'}</span>
                                                  <span className={`badge-bw-inline ${submissionData.sonetPhoto.bw ? 'bw' : 'color'}`}>{submissionData.sonetPhoto.bw ? 'Alb-Negru' : 'Color'}</span>
                                                </div>
                                              </li>
                                            )}
                                            {submissionData.personalPhotos?.map((p: any, idx: number) => (
                                              <li key={idx} className="dossier-file-item">
                                                <File size={14} className="file-icon-type" />
                                                <div className="dossier-file-details">
                                                  <span className="file-category">Personal {idx + 1}:</span>
                                                  <span className="file-name-text" title={p.name || 'photo.jpg'}>{p.name || 'photo.jpg'}</span>
                                                  <span className={`badge-bw-inline ${p.bw ? 'bw' : 'color'}`}>{p.bw ? 'Alb-Negru' : 'Color'}</span>
                                                </div>
                                              </li>
                                            ))}
                                            {submissionData.extraPhotos?.map((p: any, idx: number) => (
                                              <li key={idx} className="dossier-file-item">
                                                <File size={14} className="file-icon-type" />
                                                <div className="dossier-file-details">
                                                  <span className="file-category" style={{ color: '#D8D0C8' }}>Extra {idx + 1}:</span>
                                                  <span className="file-name-text" title={p.name || 'photo.jpg'}>{p.name || 'photo.jpg'}</span>
                                                  <span className={`badge-bw-inline ${p.bw ? 'bw' : 'color'}`}>{p.bw ? 'Alb-Negru' : 'Color'}</span>
                                                </div>
                                              </li>
                                            ))}
                                          </ul>

                                          {submissionData.voiceMessageUrl && (
                                            <div style={{ marginTop: '20px', padding: '16px', backgroundColor: '#131211', borderRadius: '10px', border: '1px solid #262423', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <Mic size={18} style={{ color: 'var(--gold-accent)' }} />
                                                <h5 style={{ margin: 0, fontSize: '13px', color: '#FAF9F6', fontWeight: 600 }}>Mesaj Vocal & Cod QR</h5>
                                              </div>
                                              <audio controls src={submissionData.voiceMessageUrl} style={{ width: '100%', height: '36px' }} />
                                              <QRCodeGenerator
                                                value={`${window.location.origin}/v/${submissionData.id || `${selectedClass.id}_${name}`}`}
                                                studentName={name}
                                                citat={submissionData.citat}
                                                audioUrl={submissionData.voiceMessageUrl}
                                                waveformData={submissionData.voiceWaveform}
                                              />
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="explorer-row-content pending" style={{ padding: '24px', textAlign: 'center', backgroundColor: '#1C1A19', borderTop: '1px solid #2D2A28' }}>
                                      <AlertCircle size={24} style={{ color: '#706E6A', marginBottom: '8px' }} />
                                      <p style={{ color: '#FAF9F6', fontSize: '13px', fontWeight: 500 }}>Acest elev nu și-a configurat încă albumul.</p>
                                      <p style={{ color: '#706E6A', fontSize: '11px', marginTop: '4px' }}>
                                        Trimiteți-i link-ul configuratorului pentru ca acesta să își poată alege fotografiile.
                                      </p>
                                    </div>
                                  )
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                </div>
                  </div>
                </div>
              </div>
            ) : (
              /* CLASSES ROOT FOLDERS GRID VIEW */
              <div className="classes-root-explorer">
                <div className="ad-page-head" style={{ marginBottom: '22px' }}>
                  <div>
                    <span className="ad-eyebrow">Albume de absolvire</span>
                    <h1 className="ad-h1">Albume absolvenți</h1>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <label className="ad-search" style={{ width: '230px' }}>
                      <Search size={14} strokeWidth={1.4} color="var(--t-muted)" />
                      <input
                        type="text"
                        placeholder="Caută școală sau diriginte"
                        value={searchClassQuery}
                        onChange={(e) => setSearchClassQuery(e.target.value)}
                      />
                    </label>
                    <Link to="/admin/create-class" className="ad-btn ad-btn-action">
                      Clasă nouă
                      <span className="ad-btn-icon"><Plus size={13} strokeWidth={1.7} /></span>
                    </Link>
                  </div>
                </div>

                {classes.length > 0 && (() => {
                  const activeCount = classes.filter(c => c.status === 'active').length;
                  const totalStudents = classes.reduce((n, c) => n + (c.studentList?.length || 0), 0);
                  const totalSubmitted = classes.reduce((n, c) => n + getSubmissionsCount(c.id), 0);
                  const lateClasses = classes.filter(c => classProgress(c).isLate);
                  const readyClasses = classes.filter(c => classProgress(c).isComplete);
                  const voicePending = Object.values(submissions).filter((s: any) => s.voiceMessageUrl).length;

                  return (
                    <div className="ad-metrics" style={{ marginBottom: '22px' }}>
                      <div className="ad-frame">
                        <div className="ad-attn-core">
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                            <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--t-mid)' }}>Necesită atenția ta</span>
                            {lateClasses.length > 0 ? (
                              <span className="ad-chip ad-chip-bad">{lateClasses.length} cu termen depășit</span>
                            ) : (
                              <span className="ad-chip ad-chip-ok">Nimic urgent</span>
                            )}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
                            {lateClasses.slice(0, 2).map(c => (
                              <div key={c.id} className="ad-attn-row">
                                <AlertCircle size={14} strokeWidth={1.4} color="var(--st-bad)" />
                                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.schoolName}</span>
                                <span className="ad-num" style={{ fontSize: '11.5px', color: 'var(--st-bad)' }}>
                                  {Math.abs(classProgress(c).daysLeft ?? 0)} zile întârziere
                                </span>
                              </div>
                            ))}
                            {voicePending > 0 && (
                              <div className="ad-attn-row">
                                <Mic size={14} strokeWidth={1.4} color="var(--a-data)" />
                                <span style={{ flex: 1 }}>Mesaje vocale primite</span>
                                <span className="ad-num" style={{ fontSize: '11.5px', color: 'var(--t-muted)' }}>{voicePending}</span>
                              </div>
                            )}
                            {lateClasses.length === 0 && voicePending === 0 && (
                              <div className="ad-attn-row">
                                <Check size={14} strokeWidth={1.4} color="var(--st-ok)" />
                                <span style={{ flex: 1 }}>Toate clasele sunt în termen</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="ad-frame" style={{ boxShadow: 'none' }}>
                        <div className="ad-core ad-metric-core">
                          <span className="ad-metric-label">Clase active</span>
                          <span className="ad-metric-value">{activeCount}</span>
                          <span className="ad-metric-foot">din {classes.length} create</span>
                        </div>
                      </div>

                      <div className="ad-frame" style={{ boxShadow: 'none' }}>
                        <div className="ad-core ad-metric-core">
                          <span className="ad-metric-label">Albume primite</span>
                          <span className="ad-metric-value">{totalSubmitted}</span>
                          <span className="ad-metric-foot">din {totalStudents} elevi</span>
                        </div>
                      </div>

                      <div className="ad-frame" style={{ boxShadow: 'none' }}>
                        <div className="ad-core ad-metric-core">
                          <span className="ad-metric-label">Gata de export</span>
                          <span className="ad-metric-value" style={{ color: readyClasses.length ? 'var(--a-data)' : undefined }}>
                            {readyClasses.length}
                          </span>
                          <span className="ad-metric-foot">clase complete</span>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {classes.length === 0 ? (
                  <div className="ad-frame">
                    <div className="ad-core" style={{ padding: '56px 32px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', textAlign: 'center' }}>
                      <span style={{ width: '44px', height: '44px', borderRadius: '13px', background: 'var(--s-overlay)', border: '1px solid var(--s-line)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--inset-hi)' }}>
                        <Folder size={19} strokeWidth={1.4} color="var(--a-data)" />
                      </span>
                      <h3 style={{ margin: '4px 0 0', fontSize: '15px', fontWeight: 600 }}>Nicio clasă încă</h3>
                      <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--t-muted)', maxWidth: '320px', lineHeight: 1.6 }}>
                        Creează prima clasă, adaugă lista elevilor și trimite-le linkul configuratorului.
                      </p>
                      <Link to="/admin/create-class" className="ad-btn ad-btn-action" style={{ marginTop: '10px' }}>
                        Creează prima clasă
                        <span className="ad-btn-icon"><Plus size={13} strokeWidth={1.7} /></span>
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div className="ad-frame">
                    <div className="ad-core ad-table">
                      <div className="ad-table-head">
                        <span>Școală</span>
                        <span>Progres albume</span>
                        <span>Termen</span>
                        <span>Stare</span>
                        <span />
                      </div>
                      {[...classes]
                        .filter(c => c.schoolName.toLowerCase().includes(searchClassQuery.toLowerCase()) || c.diriginteName.toLowerCase().includes(searchClassQuery.toLowerCase()))
                        .sort((a, b) => {
                          const da = deadlineOf(a);
                          const db = deadlineOf(b);
                          if (da && db) return da.getTime() - db.getTime();
                          if (da) return -1;
                          if (db) return 1;
                          return 0;
                        })
                        .map((cls) => {
                          const p = classProgress(cls);
                          const barColor = p.isLate
                            ? 'var(--st-bad)'
                            : p.isComplete
                              ? 'var(--st-ok)'
                              : p.pct >= 60 ? 'var(--a-data)' : '#8C765C';
                          const doneChecks = (cls.checklist || []).filter((c: any) => c.completed).length;
                          const logCount = downloadLogs.filter(log => log.classId === cls.id).length;
                          const goToClass = () => navigate(`/admin/dashboard/classes/${cls.id}`);

                          return (
                            <div
                              key={cls.id}
                              className={`ad-table-row${p.isLate ? ' is-late' : ''}`}
                              role="button"
                              tabIndex={0}
                              onClick={goToClass}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goToClass(); }
                              }}
                            >
                              <div style={{ minWidth: 0 }}>
                                <div className="ad-row-name" title={cls.schoolName} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {cls.schoolName}
                                </div>
                                <div className="ad-row-sub">{cls.diriginteName}</div>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '11px' }}>
                                <span className="ad-bar"><i style={{ width: `${p.pct}%`, backgroundColor: barColor }} /></span>
                                <span className="ad-num" style={{ fontSize: '12px', color: p.isComplete ? 'var(--st-ok)' : 'var(--t-mid)', minWidth: '52px' }}>
                                  {p.done} / {p.total}
                                </span>
                              </div>

                              <span className="ad-row-meta" style={{ color: p.isLate ? 'var(--st-bad)' : undefined }}>
                                {p.deadline
                                  ? `${p.deadline.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' })} · ${p.isLate ? 'depășit' : `${p.daysLeft} zile`}`
                                  : 'fără termen'}
                              </span>

                              <span>
                                {cls.status === 'active'
                                  ? <span className="ad-chip ad-chip-ok">Activ</span>
                                  : <span className="ad-chip ad-chip-mute">Blocat</span>}
                              </span>

                              <div className="ad-row-actions">
                                <button
                                  className="ad-icon-btn"
                                  title={`Checklist album (${doneChecks}/${(cls.checklist || []).length})`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveChecklistModal({
                                      type: 'class',
                                      id: cls.id,
                                      title: cls.schoolName,
                                      subtitle: `Diriginte: ${cls.diriginteName}`,
                                      items: cls.checklist || []
                                    });
                                  }}
                                >
                                  <CheckSquare size={13} strokeWidth={1.4} />
                                </button>
                                <button
                                  className="ad-icon-btn"
                                  title={`Loguri descărcare (${logCount})`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedLogsItem({ id: cls.id, title: cls.schoolName, type: 'class' });
                                  }}
                                >
                                  <Download size={13} strokeWidth={1.4} />
                                </button>
                                <span className="ad-icon-btn" aria-hidden="true">
                                  <ChevronRight size={13} strokeWidth={1.6} />
                                </span>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : activeTab === 'galleries' ? (
          /* PHOTO GALLERIES TAB PANEL */
          <div className="dashboard-section animate-fade">
            <div className="ad-page-head" style={{ marginBottom: '22px' }}>
              <div>
                <span className="ad-eyebrow">Livrare către clienți</span>
                <h1 className="ad-h1">Galerii foto</h1>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <label className="ad-search" style={{ width: '250px' }}>
                  <Search size={14} strokeWidth={1.4} color="var(--t-muted)" />
                  <input
                    type="text"
                    value={searchGalleryQuery}
                    onChange={(e) => setSearchGalleryQuery(e.target.value)}
                    placeholder="Caută galerie după titlu"
                  />
                </label>
                <button
                  onClick={() => {
                    setNewGallerySubtitle(photographerProfile?.name || 'ALEXIA VISUAL ARTIST');
                    setShowCreateGalleryModal(true);
                  }}
                  className="ad-btn ad-btn-action"
                >
                  Galerie nouă
                  <span className="ad-btn-icon"><Plus size={13} strokeWidth={1.7} /></span>
                </button>
              </div>
            </div>

            {galleriesError && (
              <div className="ad-frame" style={{ marginBottom: '18px' }}>
                <div className="ad-core" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '10px', borderLeft: '2px solid var(--st-bad)' }}>
                  <AlertCircle size={15} strokeWidth={1.4} color="var(--st-bad)" />
                  <span style={{ fontSize: '12.5px', color: 'var(--t-mid)' }}>
                    Eroare citire galerii din baza de date: {galleriesError}
                  </span>
                </div>
              </div>
            )}

            {photoGalleries.filter(g => g.title?.toLowerCase().includes(searchGalleryQuery.toLowerCase())).length === 0 ? (
              <div className="ad-frame">
                <div className="ad-core" style={{ padding: '56px 32px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', textAlign: 'center' }}>
                  <span style={{ width: '44px', height: '44px', borderRadius: '13px', background: 'var(--s-overlay)', border: '1px solid var(--s-line)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--inset-hi)' }}>
                    <ImageIcon size={19} strokeWidth={1.4} color="var(--a-data)" />
                  </span>
                  <h3 style={{ margin: '4px 0 0', fontSize: '15px', fontWeight: 600 }}>Nicio galerie foto</h3>
                  <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--t-muted)', maxWidth: '320px', lineHeight: 1.6 }}>
                    Încarcă pozele într-o galerie nouă, apoi trimite clientului linkul de vizualizare sau de selecție.
                  </p>
                </div>
              </div>
            ) : (
              <div className="ad-gal-grid">
                {photoGalleries
                  .filter(g => g.title?.toLowerCase().includes(searchGalleryQuery.toLowerCase()))
                  .map((gallery, index) => {
                    const totalPhotos = galleryPhotoCounts[gallery.id] !== undefined
                      ? galleryPhotoCounts[gallery.id]
                      : (gallery.subCollections || []).reduce((acc: number, sub: any) => {
                          return acc + (sub.photoCount || (Array.isArray(sub.photos) ? sub.photos.length : 0));
                        }, 0);
                    const coverFocal = gallery.coverPhoto?.focalPoint || { x: 50, y: 50 };
                    const isDraggingThis = draggedGalleryIndex === index;
                    const isDragOverThis = dragOverGalleryIndex === index;

                    return (
                      <div
                        key={gallery.id}
                        draggable={searchGalleryQuery.trim() === ''}
                        onDragStart={(e) => handleGalleryDragStart(e, index)}
                        onDragOver={(e) => handleGalleryDragOver(e, index)}
                        onDrop={(e) => handleGalleryDrop(e, index)}
                        onDragEnd={handleGalleryDragEnd}
                        className={`ad-gal-card gallery-collection-card${isDragOverThis ? ' is-dropzone' : ''}`}
                        style={{
                          cursor: searchGalleryQuery.trim() === '' ? 'grab' : 'default',
                          opacity: isDraggingThis ? 0.4 : 1,
                        }}
                      >
                        {/* Cover, with the hover action overlay kept intact */}
                        <div className="ad-gal-cover collection-image-container">
                          {(() => {
                            const coverUrl = typeof gallery.coverPhoto === 'string'
                              ? gallery.coverPhoto
                              : (gallery.coverPhoto?.previewUrl || gallery.coverPhoto?.url || gallery.coverPhoto?.cleanUrl || gallery.coverPhoto?.previewCleanUrl || '');
                            return coverUrl ? (
                              <img
                                src={coverUrl}
                                alt={gallery.title}
                                style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${coverFocal.x}% ${coverFocal.y}%` }}
                              />
                            ) : (
                              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5C5A57' }}>
                                <ImageIcon size={28} strokeWidth={1.3} />
                              </div>
                            );
                          })()}

                          <div className="ad-gal-badges">
                            {gallery.selectionEnabled && (
                              <span className="ad-gal-badge is-data">Selecții</span>
                            )}
                            <span className="ad-gal-badge ad-num">{totalPhotos} poze</span>
                          </div>

                          <div className="ad-gal-scrim">
                            <span className="ad-gal-title" title={gallery.title}>
                              {gallery.title || 'Galerie Fără Titlu'}
                            </span>
                            <span className="ad-gal-meta ad-num">{gallery.date || 'Fără dată'}</span>
                          </div>

                          {/* Hover Actions Overlay */}
                          <div
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              width: '100%',
                              height: '100%',
                              backgroundColor: 'rgba(18, 17, 16, 0.88)',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '10px',
                              opacity: 0,
                              transition: 'opacity 0.2s ease',
                              zIndex: 10,
                              boxSizing: 'border-box'
                            }}
                            className="collection-hover-overlay"
                          >
                            <Link
                              to={`/admin/edit-photo-gallery/${gallery.id}`}
                              className="collection-hover-btn collection-hover-btn-gold"
                              style={{ textDecoration: 'none' }}
                            >
                              <Settings size={13} /> Editează Galerie
                            </Link>

                            <a
                              href={`${window.location.origin}/p-gallery/${gallery.id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="collection-hover-btn collection-hover-btn-outline"
                              style={{ textDecoration: 'none' }}
                            >
                              <ExternalLink size={13} /> Vizualizează Public
                            </a>

                            <a
                              href={`${window.location.origin}/p-gallery/${gallery.id}/clean`}
                              target="_blank"
                              rel="noreferrer"
                              className="collection-hover-btn"
                              style={{
                                textDecoration: 'none',
                                backgroundColor: 'rgba(212,175,55,0.08)',
                                color: '#D4AF37',
                                border: '1px solid rgba(212,175,55,0.3)',
                                fontSize: '11px'
                              }}
                              title="Vizualizează galerie fără watermark"
                            >
                              <Unlock size={12} /> Link Editare (Fără WM)
                            </a>

                            <button
                              onClick={() => setActiveChecklistModal({
                                type: 'gallery',
                                id: gallery.id,
                                title: gallery.title,
                                subtitle: gallery.subtitle,
                                items: gallery.checklist || []
                              })}
                              className="collection-hover-btn"
                              style={{
                                textDecoration: 'none',
                                backgroundColor: 'rgba(212,175,55,0.12)',
                                color: '#D4AF37',
                                border: '1px solid rgba(212,175,55,0.4)',
                                fontSize: '11px',
                                cursor: 'pointer'
                              }}
                            >
                              <CheckSquare size={12} /> Checklist ({(gallery.checklist || []).filter((c: any) => c.completed).length}/{(gallery.checklist || []).length})
                            </button>

                            <div style={{ display: 'flex', gap: '6px', width: '190px', boxSizing: 'border-box' }}>
                              <button
                                onClick={() => copyToClipboard(`${window.location.origin}/p-gallery/${gallery.id}`, gallery.id, 'public_gallery')}
                                className="collection-hover-btn collection-hover-btn-outline"
                                style={{ flex: 1, padding: 0, width: 'auto' }}
                                title="Copiază link public"
                              >
                                {copiedId?.id === gallery.id && copiedId?.type === 'public_gallery' ? <Check size={14} style={{ color: '#2ECC71' }} /> : <Copy size={13} />}
                              </button>

                              {gallery.selectionEnabled && (
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(`${window.location.origin}/p-gallery/${gallery.id}/select`);
                                    alert('Link selecție copiat!');
                                  }}
                                  className="collection-hover-btn collection-hover-btn-outline"
                                  style={{ flex: 1, padding: 0, width: 'auto', color: '#2ECC71', borderColor: 'rgba(46,204,113,0.3)' }}
                                  title="Copiază link selecție client"
                                >
                                  <Eye size={13} />
                                </button>
                              )}

                              <button
                                onClick={() => {
                                  setDuplicateOptions({ cover: true, settings: true, folders: true, photos: true });
                                  setDuplicatingGallery(gallery);
                                }}
                                className="collection-hover-btn collection-hover-btn-outline"
                                style={{ flex: 1, padding: 0, width: 'auto' }}
                                title="Duplică Galerie"
                              >
                                <Copy size={13} />
                              </button>

                              <button
                                onClick={() => handleDeleteGallery(gallery)}
                                className="collection-hover-btn collection-hover-btn-outline"
                                style={{ flex: 1, color: '#E06C75', borderColor: '#E06C75', padding: 0, width: 'auto' }}
                                title="Șterge galeria"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Always-visible primary action — the hover overlay is unreachable on touch */}
                        <div className="ad-gal-actions">
                          <Link
                            to={`/admin/edit-photo-gallery/${gallery.id}`}
                            className="ad-gal-edit"
                          >
                            <Settings size={12} strokeWidth={1.5} /> Editează
                          </Link>
                          <a
                            href={`${window.location.origin}/p-gallery/${gallery.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="ad-icon-btn"
                            title="Vizualizează public"
                            aria-label="Vizualizează public"
                          >
                            <ExternalLink size={13} strokeWidth={1.4} />
                          </a>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        ) : (
          /* WATERMARK SETTINGS TAB PANEL */
          <div className="dashboard-section animate-fade" style={{ maxWidth: '850px', margin: '0 auto' }}>
            <div className="section-header">
              <h2>Setări Watermark & Profil</h2>
              <p className="subtitle">Gestionează watermark-urile pentru albume și galerii, ajustează-le poziția precis și configurează profilul de fotograf.</p>
            </div>

            <div className="student-dossiers-wrapper" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '32px' }}>
              {watermarkError && (
                <div style={{ backgroundColor: 'rgba(224, 108, 117, 0.1)', border: '1px solid #E06C75', color: '#E06C75', padding: '12px', borderRadius: '4px', fontSize: '13px', textAlign: 'center' }}>
                  Eroare citire bază de date: {watermarkError}
                </div>
              )}

              {/* CARD 1: WATERMARK GALERII FOTO */}
              <div style={{ border: '1px solid #2D2A28', borderRadius: '8px', padding: '20px', backgroundColor: '#131211' }}>
                <h3 style={{ fontSize: '16px', color: '#FAF9F6', margin: '0 0 6px 0', fontWeight: 600 }}>Watermark Galerii Foto</h3>
                <p style={{ color: '#706E6A', fontSize: '12px', margin: '0 0 20px 0' }}>Aplicat automat pe pozele încărcate în galeriile foto publice.</p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {watermarkSettings ? (
                    <>
                      {/* Watermark Current display */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', borderRadius: '6px', fontSize: '12px' }}>
                        <span style={{ color: '#FAF9F6', fontWeight: 500 }}>Fișier: {watermarkSettings.name}</span>
                        <button 
                          onClick={handleWatermarkDelete}
                          style={{ background: 'none', border: 'none', color: '#E06C75', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}
                        >
                          <Trash2 size={14} /> Șterge Fișier
                        </button>
                      </div>

                      <div style={{ padding: '16px', backgroundColor: '#0E0D0C', borderRadius: '6px', border: '1px solid #2D2A28', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100px' }}>
                        <img 
                          src={watermarkSettings.url} 
                          alt="Watermark Thumbnail" 
                          style={{ maxWidth: '100%', maxHeight: '60px', objectFit: 'contain', opacity: 0.6 }} 
                        />
                      </div>
                    </>
                  ) : (
                    <div style={{ border: '2px dashed #2D2A28', padding: '30px 20px', borderRadius: '6px', textAlign: 'center', backgroundColor: '#0E0D0C', color: '#706E6A', fontSize: '13px' }}>
                      <ImageIcon size={32} style={{ marginBottom: '12px' }} />
                      <p style={{ margin: '0 0 8px 0' }}>Nu există niciun watermark configurat pentru galerii.</p>
                    </div>
                  )}

                  <div style={{ borderTop: '1px solid #262423', paddingTop: '20px' }}>
                    <label className="field-label-text" style={{ fontSize: '12px', marginBottom: '8px' }}>Încarcă Watermark Nou Galerii (format PNG)</label>
                    <input 
                      type="file" 
                      accept="image/png"
                      onChange={handleWatermarkUpload}
                      id="gallery-watermark-input"
                      style={{ display: 'none' }}
                      disabled={isUploadingWatermark}
                    />
                    <button 
                      onClick={() => document.getElementById('gallery-watermark-input')?.click()}
                      className="btn btn-secondary"
                      disabled={isUploadingWatermark}
                      style={{ width: '100%', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                    >
                      {isUploadingWatermark ? (
                        <>
                          <RefreshCw className="spinner" size={16} /> Se încarcă... ({watermarkUploadProgress}%)
                        </>
                      ) : (
                        <>
                          <Upload size={16} /> Încarcă Watermark PNG
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* CARD 2: WATERMARK ALBUME ABSOLVENȚI */}
              <div style={{ border: '1px solid #2D2A28', borderRadius: '8px', padding: '20px', backgroundColor: '#131211' }}>
                <h3 style={{ fontSize: '16px', color: '#FAF9F6', margin: '0 0 6px 0', fontWeight: 600 }}>Watermark Albume Absolvenți</h3>
                <p style={{ color: '#706E6A', fontSize: '12px', margin: '0 0 20px 0' }}>Aplicat opțional pe pozele încărcate în albumele absolvenților (clase).</p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {albumWatermark ? (
                    <>
                      {/* Album Watermark Current display */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', borderRadius: '6px', fontSize: '12px' }}>
                        <span style={{ color: '#FAF9F6', fontWeight: 500 }}>Fișier: {albumWatermark.name}</span>
                        <button 
                          onClick={handleAlbumWatermarkDelete}
                          style={{ background: 'none', border: 'none', color: '#E06C75', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}
                        >
                          <Trash2 size={14} /> Șterge Fișier
                        </button>
                      </div>

                      <div style={{ padding: '16px', backgroundColor: '#0E0D0C', borderRadius: '6px', border: '1px solid #2D2A28', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100px' }}>
                        <img 
                          src={albumWatermark.url} 
                          alt="Watermark Thumbnail" 
                          style={{ maxWidth: '100%', maxHeight: '60px', objectFit: 'contain', opacity: 0.6 }} 
                        />
                      </div>
                    </>
                  ) : (
                    <div style={{ border: '2px dashed #2D2A28', padding: '30px 20px', borderRadius: '6px', textAlign: 'center', backgroundColor: '#0E0D0C', color: '#706E6A', fontSize: '13px' }}>
                      <ImageIcon size={32} style={{ marginBottom: '12px' }} />
                      <p style={{ margin: '0 0 8px 0' }}>Nu există niciun watermark configurat pentru albume.</p>
                    </div>
                  )}

                  <div style={{ borderTop: '1px solid #262423', paddingTop: '20px' }}>
                    <label className="field-label-text" style={{ fontSize: '12px', marginBottom: '8px' }}>Încarcă Watermark Nou Albume (format PNG)</label>
                    <input 
                      type="file" 
                      accept="image/png"
                      onChange={handleAlbumWatermarkUpload}
                      id="album-watermark-input"
                      style={{ display: 'none' }}
                      disabled={isUploadingAlbumWatermark}
                    />
                    <button 
                      onClick={() => document.getElementById('album-watermark-input')?.click()}
                      className="btn btn-secondary"
                      disabled={isUploadingAlbumWatermark}
                      style={{ width: '100%', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                    >
                      {isUploadingAlbumWatermark ? (
                        <>
                          <RefreshCw className="spinner" size={16} /> Se încarcă... ({albumWatermarkUploadProgress}%)
                        </>
                      ) : (
                        <>
                          <Upload size={16} /> Încarcă Watermark PNG
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Photographer Profile Configurator */}
              <div style={{ borderTop: '1px solid #262423', paddingTop: '24px', marginTop: '12px' }}>
                <h3 style={{ fontSize: '15px', color: '#FAF9F6', margin: '0 0 4px 0', fontWeight: 600 }}>Profil Fotograf</h3>
                <p style={{ color: '#706E6A', fontSize: '12px', margin: '0 0 16px 0' }}>Configurează avatarul și link-ul tău care vor fi afișate dinamic în antetul tuturor galeriilor tale foto.</p>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  
                  {/* Avatar Upload Block */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', padding: '16px', borderRadius: '6px' }}>
                    <div style={{ width: '64px', height: '64px', borderRadius: '8px', overflow: 'hidden', border: '1px solid #363433', backgroundColor: '#1A1A1A', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {photographerProfile?.avatarUrl ? (
                        <img 
                          src={photographerProfile.avatarUrl} 
                          alt="Avatar" 
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                        />
                      ) : (
                        <ImageIcon size={24} style={{ color: '#5C5A57' }} />
                      )}
                    </div>
                    
                    <div style={{ flex: 1 }}>
                      <input 
                        type="file" 
                        accept="image/*"
                        onChange={handleAvatarUpload}
                        id="avatar-file-input"
                        style={{ display: 'none' }}
                        disabled={isUploadingAvatar}
                      />
                      <button 
                        type="button"
                        onClick={() => document.getElementById('avatar-file-input')?.click()}
                        className="btn btn-secondary"
                        disabled={isUploadingAvatar}
                        style={{ fontSize: '12px', padding: '6px 12px', height: 'auto', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                      >
                        {isUploadingAvatar ? (
                          <>
                            <RefreshCw className="spinner" size={13} /> Se încarcă... ({avatarUploadProgress}%)
                          </>
                        ) : (
                          <>
                            <Upload size={13} /> Schimbă poză profil
                          </>
                        )}
                      </button>
                      <p style={{ margin: '6px 0 0 0', fontSize: '11px', color: '#5C5A57' }}>Recomandat: imagine pătrată, format JPG/PNG, maxim 500x500px.</p>
                    </div>
                  </div>

                  {/* Name field */}
                  <div>
                    <label className="field-label-text" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#706E6A', display: 'block', marginBottom: '8px' }}>Nume Implicit Fotograf</label>
                    <input 
                      type="text" 
                      value={profileNameInput} 
                      onChange={(e) => setProfileNameInput(e.target.value)} 
                      placeholder="e.g. ALEXIA VISUAL ARTIST"
                      style={{ width: '100%', padding: '10px 12px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '4px', fontSize: '14px', outline: 'none' }}
                    />
                  </div>

                  {/* Redirection Link field */}
                  <div>
                    <label className="field-label-text" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#706E6A', display: 'block', marginBottom: '8px' }}>Link Click-abil Profil (Instagram, Website, Facebook)</label>
                    <input 
                      type="text" 
                      value={profileLinkInput} 
                      onChange={(e) => setProfileLinkInput(e.target.value)} 
                      placeholder="e.g. https://instagram.com/alexiavisualartist"
                      style={{ width: '100%', padding: '10px 12px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '4px', fontSize: '14px', outline: 'none' }}
                    />
                  </div>

                  {/* Save button */}
                  <button 
                    onClick={handleSaveProfile}
                    className="btn btn-gold"
                    style={{ width: '100%', height: '44px', marginTop: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    Salvează Profil Fotograf
                  </button>

                </div>
              </div>
            </div>
          </div>

        )}

      {/* 1.5. Gallery/Album Specific Download Logs Modal */}
      {selectedLogsItem && (
        <div className="admin-modal-overlay" style={{ zIndex: 1100 }} onClick={() => { setSelectedLogsItem(null); setSearchLogEmailQuery(''); }}>
          <div className="admin-modal-card" style={{ maxWidth: '750px', width: '90%', padding: '24px', backgroundColor: '#161514', border: '1px solid #2D2A28' }} onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid #262423', paddingBottom: '16px' }}>
              <div>
                <h3 style={{ fontSize: '18px', fontWeight: 600, color: '#FAF9F6', margin: 0 }}>
                  Jurnal Descărcări: {selectedLogsItem.title}
                </h3>
                <p className="admin-modal-subtitle" style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#706E6A' }}>
                  {selectedLogsItem.type === 'class' ? 'Album Absolvenți' : 'Galerie Foto'} • Urmărește descărcările clienților
                </p>
              </div>
              <button 
                className="admin-modal-close" 
                onClick={() => { setSelectedLogsItem(null); setSearchLogEmailQuery(''); }}
                style={{ background: 'none', border: 'none', color: '#FAF9F6', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '6px' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <div className="search-bar" style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', borderRadius: '4px' }}>
                <Search size={16} style={{ color: '#706E6A', marginRight: '8px' }} />
                <input 
                  type="text" 
                  value={searchLogEmailQuery}
                  onChange={(e) => setSearchLogEmailQuery(e.target.value)}
                  placeholder="Caută după email sau fișier..." 
                  style={{ flex: 1, background: 'none', border: 'none', color: '#FAF9F6', outline: 'none', fontSize: '13px' }}
                />
              </div>
            </div>

            <div style={{ maxHeight: '400px', overflowY: 'auto' }} className="hide-scrollbar">
              {(() => {
                const filtered = downloadLogs
                  .filter(log => {
                    const matchId = selectedLogsItem.type === 'class' 
                      ? log.classId === selectedLogsItem.id 
                      : log.galleryId === selectedLogsItem.id;
                    
                    if (!matchId) return false;
                    if (!searchLogEmailQuery) return true;
                    
                    const q = searchLogEmailQuery.toLowerCase();
                    const matchEmail = log.email?.toLowerCase().includes(q);
                    const matchFiles = log.filesList?.some(f => f.toLowerCase().includes(q));
                    return matchEmail || matchFiles;
                  });

                if (filtered.length === 0) {
                  return (
                    <div style={{ padding: '40px 20px', textAlign: 'center', color: '#706E6A', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                      <FileText size={40} style={{ opacity: 0.5 }} />
                      <h4 style={{ color: '#FAF9F6', margin: 0, fontSize: '14px' }}>Niciun log găsit</h4>
                      <p style={{ margin: 0, fontSize: '12px' }}>Nu există descărcări care să corespundă criteriilor.</p>
                    </div>
                  );
                }

                return (
                  <div className="table-responsive">
                    <table className="logs-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                      <thead>
                        <tr style={{ textAlign: 'left', borderBottom: '1px solid #262423' }}>
                          <th style={{ padding: '12px 8px', color: '#706E6A', fontWeight: 600 }}>Dată</th>
                          <th style={{ padding: '12px 8px', color: '#706E6A', fontWeight: 600 }}>Email utilizator</th>
                          <th style={{ padding: '12px 8px', color: '#706E6A', fontWeight: 600 }}>Tip</th>
                          <th style={{ padding: '12px 8px', color: '#706E6A', fontWeight: 600 }}>Fișiere descarcate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((log) => {
                          const date = log.downloadedAt?.toDate 
                            ? log.downloadedAt.toDate().toLocaleString('ro-RO')
                            : 'N/A';
                          
                          const isZip = log.filesList?.some(f => f.includes('ZIP') || f.includes('Arhivă'));

                          return (
                            <tr key={log.id} style={{ borderBottom: '1px solid #1C1A19' }}>
                              <td style={{ padding: '12px 8px', color: '#A3A09B' }}>{date}</td>
                              <td style={{ padding: '12px 8px', color: '#FAF9F6', fontWeight: 500 }} className="email-cell">{log.email}</td>
                              <td style={{ padding: '12px 8px' }}>
                                <span className={`download-type-badge ${isZip ? 'zip' : 'single'}`} style={{
                                  fontSize: '10px',
                                  padding: '2px 6px',
                                  borderRadius: '3px',
                                  fontWeight: 600,
                                  backgroundColor: isZip ? 'rgba(212, 175, 55, 0.15)' : 'rgba(112, 110, 106, 0.15)',
                                  color: isZip ? 'var(--gold-accent)' : '#FAF9F6'
                                }}>
                                  {isZip ? 'ZIP Archive' : 'Imagine'}
                                </span>
                              </td>
                              <td style={{ padding: '12px 8px', color: '#A3A09B', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={log.filesList?.join(', ')}>
                                <Download size={12} style={{ marginRight: '6px', display: 'inline', verticalAlign: 'middle' }} />
                                {log.filesList?.length || 0} fișier(e) ({log.filesList?.slice(0, 2).join(', ')}{log.filesList && log.filesList.length > 2 ? '...' : ''})
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>

            <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #262423', paddingTop: '16px' }}>
              <button 
                onClick={() => { setSelectedLogsItem(null); setSearchLogEmailQuery(''); }}
                className="btn btn-secondary"
                style={{ padding: '8px 16px', fontSize: '13px' }}
              >
                Închide
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Student Submission Details Modal (Viewer Lightbox) */}
      {selectedSubmission && (
        <div className="admin-modal-overlay" style={{ zIndex: 1100 }}>
          <div className="admin-modal-card details-view-card">
            <div className="admin-modal-header">
              <div>
                <h3>Selecție Album: {selectedSubmission.studentName}</h3>
                <p className="admin-modal-subtitle">Configurat la: {selectedSubmission.submittedAt?.toDate ? selectedSubmission.submittedAt.toDate().toLocaleString('ro-RO') : 'N/A'}</p>
              </div>
              <button className="admin-modal-close" onClick={() => setSelectedSubmission(null)}>
                <X size={20} />
              </button>
            </div>

            <div className="submission-scroll-details">
              {/* Summary Banner */}
              <div className="details-section" style={{ backgroundColor: '#1C1A19', padding: '16px', borderRadius: '8px', border: '1px solid #2D2A28' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                  <div>
                    <span className="photo-type-label">Nume pe album:</span>
                    <h5 style={{ margin: '2px 0 0 0', color: 'var(--gold-accent)', fontSize: '15px' }}>{selectedSubmission.albumName || selectedSubmission.studentName}</h5>
                  </div>
                  <div>
                    <span className="photo-type-label">Tip Album:</span>
                    <h5 style={{ margin: '2px 0 0 0', color: '#FAF9F6', fontSize: '14px', textTransform: 'uppercase' }}>
                      {selectedSubmission.selectedAlbumType === 'mic' ? 'Album Mic' : 'Album Mare'}
                    </h5>
                  </div>
                  <div>
                    <span className="photo-type-label">Cost Total Estimat:</span>
                    <h5 style={{ margin: '2px 0 0 0', color: 'var(--gold-accent)', fontSize: '15px', fontWeight: 700 }}>
                      {selectedSubmission.totalCost ?? 0} RON
                    </h5>
                  </div>
                </div>
              </div>

              {/* Cover & Classmates photos */}
              <div className="details-section">
                <h4>Fotografii Principale</h4>
                <div className="detail-photos-row">
                  <div className="detail-photo-card">
                    <span className="photo-type-label">Copertă</span>
                    <a href={selectedSubmission.copertaPhoto?.processedUrl || selectedSubmission.copertaPhoto?.url} target="_blank" rel="noreferrer">
                      <img 
                        src={selectedSubmission.copertaPhoto?.processedUrl || selectedSubmission.copertaPhoto?.url} 
                        alt="Coperta" 
                        className={selectedSubmission.copertaPhoto?.bw ? 'grayscale' : ''}
                      />
                    </a>
                    {selectedSubmission.copertaPhoto?.bw && <span className="bw-overlay-badge">B/W</span>}
                    <span className="detail-filename-label" title={selectedSubmission.copertaPhoto?.name}>{selectedSubmission.copertaPhoto?.name || 'Nespecificat'}</span>
                  </div>

                  <div className="detail-photo-card">
                    <span className="photo-type-label">Colegi</span>
                    <a href={selectedSubmission.colegiPhoto?.processedUrl || selectedSubmission.colegiPhoto?.url} target="_blank" rel="noreferrer">
                      <img 
                        src={selectedSubmission.colegiPhoto?.processedUrl || selectedSubmission.colegiPhoto?.url} 
                        alt="Colegi" 
                        className={selectedSubmission.colegiPhoto?.bw ? 'grayscale' : ''}
                      />
                    </a>
                    {selectedSubmission.colegiPhoto?.bw && <span className="bw-overlay-badge">B/W</span>}
                    <span className="detail-filename-label" title={selectedSubmission.colegiPhoto?.name}>{selectedSubmission.colegiPhoto?.name || 'Nespecificat'}</span>
                  </div>
                </div>
              </div>

              {/* Personal photos */}
              <div className="details-section">
                <h4>Fotografii Personale ({selectedSubmission.personalPhotos?.length || 0})</h4>
                <div className="detail-photo-grid">
                  {selectedSubmission.personalPhotos?.map((p: any, idx: number) => (
                    <div key={idx} className="detail-grid-card">
                      <a href={p.processedUrl || p.url} target="_blank" rel="noreferrer">
                        <img src={p.processedUrl || p.url} alt={`Personal ${idx}`} className={p.bw ? 'grayscale' : ''} />
                      </a>
                      {p.bw && <span className="bw-overlay-badge-small">B/W</span>}
                      <span className="detail-filename-label" title={p.name}>{p.name || 'photo.jpg'}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Poster photo */}
              {selectedSubmission.wantsPoster && selectedSubmission.posterPhoto && (
                <div className="details-section">
                  <h4>Poză pentru Poster</h4>
                  <div className="detail-photos-row">
                    <div className="detail-photo-card" style={{ maxWidth: '240px' }}>
                      <a href={selectedSubmission.posterPhoto.processedUrl || selectedSubmission.posterPhoto.url} target="_blank" rel="noreferrer">
                        <img src={selectedSubmission.posterPhoto.processedUrl || selectedSubmission.posterPhoto.url} alt="Poster" className={selectedSubmission.posterPhoto.bw ? 'grayscale' : ''} />
                      </a>
                      {selectedSubmission.posterPhoto.bw && <span className="bw-overlay-badge">B/W</span>}
                      <span className="detail-filename-label" title={selectedSubmission.posterPhoto.name}>{selectedSubmission.posterPhoto.name || 'poster.jpg'}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Sonete Școlare */}
              {(selectedSubmission.wantsSonetPhoto || selectedSubmission.wantsSonetCitat || selectedSubmission.hasSonet) && (
                <div className="details-section">
                  <h4>Sonet Școlar</h4>
                  {selectedSubmission.sonetPhoto && (
                    <div className="detail-photos-row" style={{ marginBottom: '12px' }}>
                      <div className="detail-photo-card" style={{ maxWidth: '240px' }}>
                        <span className="photo-type-label">Poză Sonet</span>
                        <a href={selectedSubmission.sonetPhoto.processedUrl || selectedSubmission.sonetPhoto.url} target="_blank" rel="noreferrer">
                          <img src={selectedSubmission.sonetPhoto.processedUrl || selectedSubmission.sonetPhoto.url} alt="Sonet" className={selectedSubmission.sonetPhoto.bw ? 'grayscale' : ''} />
                        </a>
                        {selectedSubmission.sonetPhoto.bw && <span className="bw-overlay-badge">B/W</span>}
                        <span className="detail-filename-label" title={selectedSubmission.sonetPhoto.name}>{selectedSubmission.sonetPhoto.name || 'sonet.jpg'}</span>
                      </div>
                    </div>
                  )}
                  {selectedSubmission.citatSonet && (
                    <div className="admin-text-box">
                      <span className="photo-type-label">Citat Sonet:</span>
                      <p className="quote-text-admin" style={{ color: '#E5C158' }}>„{selectedSubmission.citatSonet}”</p>
                    </div>
                  )}
                </div>
              )}

              {/* Quote & notes */}
              <div className="details-section">
                <h4>Informații Text Album</h4>
                {selectedSubmission.citat && (
                  <div className="admin-text-box">
                    <span className="photo-type-label">Citat Album:</span>
                    <p className="quote-text-admin">„{selectedSubmission.citat}”</p>
                  </div>
                )}
                {selectedSubmission.observatii && (
                  <div className="admin-text-box" style={{ marginTop: '12px' }}>
                    <span className="photo-type-label">Observații pentru designer:</span>
                    <p className="notes-text-admin">{selectedSubmission.observatii}</p>
                  </div>
                )}
              </div>

              {/* Extra Purchases / Products */}
              {selectedSubmission.wantsExtraItems && selectedSubmission.extraItemsText && (
                <div className="details-section">
                  <h4>Cumpărături Extra (Produse suplimentare)</h4>
                  <div className="admin-text-box">
                    <p className="notes-text-admin" style={{ color: 'var(--gold-accent)', fontStyle: 'normal' }}>{selectedSubmission.extraItemsText}</p>
                  </div>
                </div>
              )}

              {/* Extra Photos if enabled */}
              {selectedSubmission.extraPagesEnabled && selectedSubmission.extraPhotos && selectedSubmission.extraPhotos.length > 0 && (
                <div className="details-section">
                  <h4>Pagini Extra ({selectedSubmission.extraPhotos.length} poze)</h4>
                  <div className="detail-photo-grid">
                    {selectedSubmission.extraPhotos.map((p: any, idx: number) => (
                      <div key={idx} className="detail-grid-card">
                        <a href={p.processedUrl || p.url} target="_blank" rel="noreferrer">
                          <img src={p.processedUrl || p.url} alt={`Extra ${idx}`} className={p.bw ? 'grayscale' : ''} />
                        </a>
                        {p.bw && <span className="bw-overlay-badge-small">B/W</span>}
                        <span className="detail-filename-label" title={p.name}>{p.name || 'photo.jpg'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="admin-modal-footer">
              <button className="btn btn-secondary" onClick={() => setSelectedSubmission(null)}>Înapoi</button>
            </div>
          </div>
        </div>
      )}

      {/* Duplication Modal */}
      {duplicatingGallery && (
        <div className="admin-modal-overlay">
          <div className="admin-modal-container" style={{ maxWidth: '480px', backgroundColor: '#161514', border: '1px solid #262423' }}>
            <div className="admin-modal-header" style={{ borderBottom: '1px solid #262423', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', color: '#FAF9F6' }}>Duplicare Galerie</h3>
              <button 
                onClick={() => !isDuplicating && setDuplicatingGallery(null)} 
                style={{ background: 'none', border: 'none', color: '#706E6A', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px' }}
                disabled={isDuplicating}
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="admin-modal-body" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {isDuplicating ? (
                <div style={{ textAlign: 'center', padding: '30px 10px' }}>
                  <RefreshCw className="spinner" size={32} style={{ color: 'var(--gold-accent)', marginBottom: '16px' }} />
                  <h4 style={{ color: '#FAF9F6', margin: '0 0 8px 0' }}>Se duplică galeria...</h4>
                  <p style={{ color: '#706E6A', fontSize: '13px', margin: '6px 0 0 0' }}>
                    Copiere fișiere: {duplicateProgress.current} / {duplicateProgress.total} finalizate.
                  </p>
                  <div style={{ width: '100%', height: '6px', backgroundColor: '#0E0D0C', borderRadius: '3px', marginTop: '16px', overflow: 'hidden' }}>
                    <div 
                      style={{ 
                        height: '100%', 
                        backgroundColor: 'var(--gold-accent)', 
                        width: `${duplicateProgress.total > 0 ? (duplicateProgress.current / duplicateProgress.total) * 100 : 100}%`,
                        transition: 'width 0.2s ease'
                      }} 
                    />
                  </div>
                </div>
              ) : (
                <>
                  <p style={{ color: '#A3A09B', fontSize: '13px', margin: 0, lineHeight: 1.4 }}>
                    Alege tipul de duplicare sau selectează elementele specifice pe care dorești să le incluzi în copia galeriei:
                  </p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', backgroundColor: '#0E0D0C', padding: '14px', borderRadius: '6px', border: '1px solid #262423', marginTop: '4px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#FAF9F6', fontSize: '13px', cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        checked={duplicateOptions.cover} 
                        onChange={(e) => setDuplicateOptions(prev => ({ ...prev, cover: e.target.checked }))}
                        style={{ accentColor: 'var(--gold-accent)' }}
                      />
                      Imagine Copertă & Detalii Copertă
                    </label>
                    
                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#FAF9F6', fontSize: '13px', cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        checked={duplicateOptions.settings} 
                        onChange={(e) => setDuplicateOptions(prev => ({ ...prev, settings: e.target.checked }))}
                        style={{ accentColor: 'var(--gold-accent)' }}
                      />
                      Setări Watermark & Tipografie
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#FAF9F6', fontSize: '13px', cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        checked={duplicateOptions.folders} 
                        onChange={(e) => setDuplicateOptions(prev => ({ ...prev, folders: e.target.checked }))}
                        style={{ accentColor: 'var(--gold-accent)' }}
                      />
                      Structură Foldere / Sub-colecții
                    </label>

                    <label 
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '10px', 
                        color: duplicateOptions.folders ? '#FAF9F6' : '#5C5A57', 
                        fontSize: '13px', 
                        cursor: duplicateOptions.folders ? 'pointer' : 'not-allowed',
                        paddingLeft: '16px'
                      }}
                    >
                      <input 
                        type="checkbox" 
                        disabled={!duplicateOptions.folders}
                        checked={duplicateOptions.folders && duplicateOptions.photos} 
                        onChange={(e) => setDuplicateOptions(prev => ({ ...prev, photos: e.target.checked }))}
                        style={{ accentColor: 'var(--gold-accent)' }}
                      />
                      Copiază și fotografiile din foldere
                    </label>
                  </div>
                </>
              )}
            </div>

            {!isDuplicating && (
              <div className="admin-modal-footer" style={{ borderTop: '1px solid #262423', gap: '8px', display: 'flex', justifyContent: 'flex-end', padding: '16px 20px' }}>
                <button className="btn btn-secondary" onClick={() => setDuplicatingGallery(null)} style={{ padding: '8px 16px', fontSize: '12px' }}>
                  Anulează
                </button>
                <button 
                  className="btn btn-secondary" 
                  onClick={() => handleExecuteDuplicate(duplicatingGallery, false)} 
                  style={{ padding: '8px 16px', fontSize: '12px', border: '1px solid var(--gold-accent)', color: 'var(--gold-accent)' }}
                >
                  Duplicare Personalizată
                </button>
                <button 
                  className="btn btn-gold" 
                  onClick={() => handleExecuteDuplicate(duplicatingGallery, true)} 
                  style={{ padding: '8px 16px', fontSize: '12px' }}
                >
                  Duplicare Rapidă (Tot)
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create New Gallery Modal */}
      {showCreateGalleryModal && (
        <div className="admin-modal-overlay">
          <div className="admin-modal-container" style={{ maxWidth: '520px', backgroundColor: '#161514', border: '1px solid #262423' }}>
            <div className="admin-modal-header" style={{ borderBottom: '1px solid #262423', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px' }}>
              <h3 style={{ margin: 0, fontSize: '18px', color: '#FAF9F6', fontWeight: 600 }}>Creează Galerie Foto Nouă</h3>
              <button 
                onClick={() => !isCreatingGallery && setShowCreateGalleryModal(false)} 
                style={{ background: 'none', border: 'none', color: '#706E6A', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px' }}
                disabled={isCreatingGallery}
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="admin-modal-body" style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {isCreatingGallery ? (
                <div style={{ textAlign: 'center', padding: '40px 10px' }}>
                  <RefreshCw className="spinner" size={32} style={{ color: 'var(--gold-accent)', marginBottom: '16px' }} />
                  <h4 style={{ color: '#FAF9F6', margin: '0 0 8px 0' }}>Se inițializează galeria...</h4>
                  <p style={{ color: '#706E6A', fontSize: '13px', margin: 0 }}>
                    Vă rugăm să așteptați. Se creează galeria în Firestore...
                  </p>
                </div>
              ) : (
                <>
                  <div>
                    <label className="field-label-text" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#706E6A', display: 'block', marginBottom: '8px' }}>Nume Galerie (Ex: Denis & Dominika)</label>
                    <input 
                      type="text" 
                      value={newGalleryTitle} 
                      onChange={(e) => setNewGalleryTitle(e.target.value)} 
                      placeholder="e.g. Denis & Dominika"
                      style={{ width: '100%', padding: '10px 12px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '4px', fontSize: '14px', outline: 'none' }}
                    />
                  </div>

                  <div>
                    <label className="field-label-text" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#706E6A', display: 'block', marginBottom: '8px' }}>Subtitlu Copertă (Ex: Alexia Visual Artist)</label>
                    <input 
                      type="text" 
                      value={newGallerySubtitle} 
                      onChange={(e) => setNewGallerySubtitle(e.target.value)} 
                      placeholder="e.g. ALEXIA VISUAL ARTIST"
                      style={{ width: '100%', padding: '10px 12px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '4px', fontSize: '14px', outline: 'none' }}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <div>
                      <label className="field-label-text" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#706E6A', display: 'block', marginBottom: '8px' }}>Data Evenimentului</label>
                      <input 
                        type="date" 
                        value={newGalleryDate} 
                        onChange={(e) => setNewGalleryDate(e.target.value)}
                        style={{ width: '100%', padding: '10px 12px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '4px', fontSize: '13px', outline: 'none', height: '42px' }}
                      />
                    </div>

                    <div>
                      <label className="field-label-text" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#706E6A', display: 'block', marginBottom: '8px' }}>Aplică Watermark implicit?</label>
                      <select 
                        value={newGalleryWatermark ? 'yes' : 'no'}
                        onChange={(e) => setNewGalleryWatermark(e.target.value === 'yes')}
                        style={{ width: '100%', padding: '10px 12px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '4px', fontSize: '13px', outline: 'none', height: '42px' }}
                      >
                        <option value="no">Nu aplica</option>
                        <option value="yes">Da, aplică watermark implicit</option>
                      </select>
                    </div>
                  </div>
                </>
              )}
            </div>

            {!isCreatingGallery && (
              <div className="admin-modal-footer" style={{ borderTop: '1px solid #262423', gap: '8px', display: 'flex', justifyContent: 'flex-end', padding: '16px 20px' }}>
                <button className="btn btn-secondary" onClick={() => setShowCreateGalleryModal(false)} style={{ padding: '8px 16px', fontSize: '12px' }}>
                  Anulează
                </button>
                <button 
                  className="btn btn-gold" 
                  onClick={handleExecuteCreateGallery} 
                  style={{ padding: '8px 16px', fontSize: '12px' }}
                  disabled={!newGalleryTitle.trim()}
                >
                  Creează Galerie & Continuă
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        .collection-image-container:hover .collection-hover-overlay {
          opacity: 1 !important;
        }
        .gallery-collection-card:hover .collection-image-container img {
          transform: scale(1.03);
        }
        .collection-image-container img {
          transition: transform 0.3s ease;
        }

        .collection-hover-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          width: 190px;
          height: 36px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          cursor: pointer;
          border: none;
          transition: all 0.2s ease;
          padding: 0 12px;
          box-sizing: border-box;
          font-family: 'Outfit', sans-serif;
        }
        .collection-hover-btn-gold {
          background-color: var(--gold-accent);
          color: #FAF9F6;
        }
        .collection-hover-btn-gold:hover {
          background-color: var(--gold-hover);
          transform: translateY(-1px);
        }
        .collection-hover-btn-outline {
          background-color: rgba(18, 17, 16, 0.6);
          color: #FAF9F6;
          border: 1px solid #706E6A;
        }
        .collection-hover-btn-outline:hover {
          background-color: #FAF9F6;
          color: #121110;
          border-color: #FAF9F6;
        }

        /* .admin-wrapper / .admin-header / .header-logo / .admin-badge / .header-nav /
           .nav-link / .logout-btn / .admin-main now live in src/index.css via AdminLayout */

        .dashboard-section {
          animation: fadeIn 0.4s ease;
        }

        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
        }

        .section-header h2 {
          font-size: 28px;
          font-weight: 400;
          margin-bottom: 4px;
        }

        .create-class-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 12px 20px;
          background-color: var(--gold-accent);
          color: #D8D0C8;
          border: none;
          border-radius: 4px;
          font-size: 14px;
          font-weight: 600;
          text-decoration: none;
          transition: all 0.2s ease;
          box-shadow: 0 4px 12px rgba(197, 168, 128, 0.15);
        }

        .create-class-btn:hover {
          transform: translateY(-1px);
          opacity: 0.95;
        }

        /* Folders Explorer Style */
        .folders-explorer-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 20px;
          margin-top: 16px;
        }

        .folder-explorer-card {
          background-color: #161514;
          border: 1px solid #262423;
          border-radius: 8px;
          padding: 24px;
          display: flex;
          align-items: flex-start;
          gap: 20px;
          cursor: pointer;
          transition: all 0.2s;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }

        .folder-explorer-card:hover {
          transform: translateY(-2px);
          border-color: var(--gold-accent);
          box-shadow: 0 8px 24px rgba(197, 168, 128, 0.08);
        }

        .folder-icon-wrapper {
          color: var(--gold-accent);
          margin-top: 2px;
          background-color: rgba(197, 168, 128, 0.05);
          padding: 12px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .folder-info {
          flex: 1;
          overflow: hidden;
        }

        .folder-school-title {
          font-size: 18px;
          font-weight: 500;
          margin-bottom: 4px;
          color: #FAF9F6;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .folder-teacher-span {
          font-size: 12px;
          color: #A3A09B;
        }

        .folder-progress-section {
          width: 100%;
        }

        .progress-labels {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          color: #706E6A;
          margin-bottom: 6px;
        }

        .progress-bar-container {
          height: 6px;
          background-color: #2D2A28;
          border-radius: 3px;
          overflow: hidden;
          width: 100%;
        }

        .progress-bar-fill {
          height: 100%;
          background-color: var(--gold-accent);
          border-radius: 3px;
          transition: width 0.3s ease;
        }

        /* Directory Drill Down View */
        .directory-breadcrumbs-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 18px;
        }

        .breadcrumbs {
          display: flex;
          align-items: center;
          gap: 11px;
        }

        .breadcrumb-btn {
          background: var(--s-sunken);
          border: 1px solid var(--s-hairline);
          color: var(--t-lo);
          font-size: 12px;
          font-weight: 500;
          font-family: inherit;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 6px 12px 6px 10px;
          border-radius: 8px;
          transition: all 0.2s var(--ease-spring);
        }

        .breadcrumb-btn:hover {
          color: var(--t-hi);
          background: var(--s-overlay);
          border-color: var(--s-line-strong);
        }

        .breadcrumb-btn:active { transform: scale(0.98); }

        .breadcrumb-separator {
          color: #3A3734;
        }

        .breadcrumb-current {
          color: var(--t-muted);
          font-size: 12px;
          font-weight: 400;
        }

        .btn-back-root {
          padding: 8px 16px;
          font-size: 12px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        /* Class Settings Header Panel — nested frame + core */
        .class-settings-card {
          background: var(--s-sunken);
          border: 1px solid var(--s-hairline);
          border-radius: var(--r-frame);
          padding: 5px;
          margin-bottom: 18px;
          box-shadow: var(--e-2);
        }

        .card-top-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 24px;
          flex-wrap: wrap;
          background: linear-gradient(150deg, #1C1614 0%, var(--s-raised) 55%);
          border-radius: var(--r-core) var(--r-core) 0 0;
          border-bottom: 1px solid var(--s-hairline);
          box-shadow: inset 0 1px 0 rgba(243, 237, 231, 0.05);
          padding: 20px 22px 18px;
          margin-bottom: 0;
        }

        .card-top-header h2 {
          font-size: 22px;
          font-weight: 600;
          letter-spacing: -0.025em;
          line-height: 1.15;
          color: var(--t-hi);
          margin-bottom: 5px;
        }

        .subtitle-teacher {
          font-size: 12.5px;
          color: var(--t-muted);
        }

        .settings-panel-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 28px;
          background: var(--s-raised);
          border-radius: 0 0 var(--r-core) var(--r-core);
          padding: 20px 22px 22px;
        }

        @media (max-width: 900px) {
          .settings-panel-grid {
            grid-template-columns: 1fr;
            gap: 24px;
          }
        }

        .settings-column {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }

        .settings-col-title {
          font-size: 11px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--t-faint);
          margin-bottom: 12px;
          font-weight: 500;
        }

        .link-field-wrapper {
          width: 100%;
        }

        .field-label-text {
          font-size: 11px;
          color: var(--t-muted);
          display: block;
          margin-bottom: 5px;
        }

        .field-input-row {
          display: flex;
          align-items: center;
          gap: 7px;
          background: var(--s-sunken);
          border: 1px solid var(--s-hairline);
          padding: 7px 8px 7px 12px;
          border-radius: 10px;
          box-shadow: var(--inset-lo);
          transition: border-color 0.2s var(--ease-spring);
        }

        .field-input-row:hover { border-color: var(--s-line); }
        .field-input-row:focus-within { border-color: var(--a-data-line); }

        .field-input-row input {
          flex: 1;
          background: none;
          border: none;
          color: var(--t-mid);
          font-size: 12px;
          font-family: inherit;
          outline: none;
          overflow: hidden;
          text-overflow: ellipsis;
          min-width: 0;
        }

        .meta-params-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .meta-param-item {
          display: flex;
          justify-content: space-between;
          font-size: 13px;
          color: #A3A09B;
          border-bottom: 1px dashed #262423;
          padding-bottom: 6px;
        }

        .meta-param-item strong {
          color: #FAF9F6;
        }

        .toggle-action-btn {
          flex: 1;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 10px 14px;
          font-size: 12px;
          font-weight: 600;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.2s ease;
          border: none;
        }

        .btn-lock {
          background-color: rgba(224, 108, 117, 0.1);
          color: #E06C75;
          border: 1px solid rgba(224, 108, 117, 0.2);
        }

        .btn-lock:hover {
          background-color: rgba(224, 108, 117, 0.2);
        }

        .btn-unlock {
          background-color: rgba(152, 195, 121, 0.1);
          color: #98C379;
          border: 1px solid rgba(152, 195, 121, 0.2);
        }

        .btn-unlock:hover {
          background-color: rgba(152, 195, 121, 0.2);
        }

        /* Toggle checkbox styles */
        .toggle-label-wrapper {
          display: inline-flex;
          align-items: center;
          cursor: pointer;
          user-select: none;
          font-size: 12px;
          color: #A3A09B;
          gap: 8px;
        }

        .toggle-label-wrapper input {
          position: absolute;
          opacity: 0;
          cursor: pointer;
          height: 0;
          width: 0;
        }

        .toggle-custom-checkbox {
          position: relative;
          height: 16px;
          width: 30px;
          background-color: #2D2A28;
          border-radius: 10px;
          transition: background-color 0.2s ease;
        }

        .toggle-custom-checkbox::before {
          content: "";
          position: absolute;
          height: 12px;
          width: 12px;
          left: 2px;
          bottom: 2px;
          background-color: #706E6A;
          border-radius: 50%;
          transition: transform 0.2s ease, background-color 0.2s;
        }

        .toggle-label-wrapper input:checked ~ .toggle-custom-checkbox {
          background-color: var(--gold-accent);
        }

        .toggle-label-wrapper input:checked ~ .toggle-custom-checkbox::before {
          transform: translateX(14px);
          background-color: #121110;
        }

        /* Dossiers Section list */
        .student-dossiers-wrapper {
          background: transparent;
          border: none;
          border-radius: 0;
          padding: 0;
        }

        .dossiers-header-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          flex-wrap: wrap;
          margin-bottom: 14px;
          border-bottom: none;
          padding-bottom: 0;
        }

        .dossiers-header-row h3 {
          font-size: 14px;
          font-weight: 600;
          letter-spacing: -0.01em;
          color: var(--t-hi);
        }

        .explorer-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        /* Student dossier rows — flat list, marked in the margin instead of boxed */
        .explorer-row-item {
          background: var(--s-raised);
          border: none;
          border-bottom: 1px solid #1B1918;
          border-left: 2px solid transparent;
          border-radius: 0;
          overflow: hidden;
          transition: background-color 0.2s var(--ease-spring), border-left-color 0.2s var(--ease-spring);
        }

        .explorer-row-item:first-child { border-radius: var(--r-core) var(--r-core) 0 0; }
        .explorer-row-item:last-child { border-bottom: none; border-radius: 0 0 var(--r-core) var(--r-core); }

        .explorer-row-item.expanded {
          background: #1A1817;
          border-left-color: var(--a-data);
        }

        .explorer-row-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 14px;
          padding: 12px 18px;
          cursor: pointer;
          user-select: none;
        }

        .explorer-row-header:hover {
          background-color: #1A1817;
        }

        .explorer-item-title-section {
          display: flex;
          align-items: center;
          gap: 13px;
          min-width: 0;
        }

        .arrow-exp {
          color: var(--t-faint);
          flex-shrink: 0;
          transition: color 0.2s var(--ease-spring);
        }

        .explorer-row-item.expanded .arrow-exp { color: var(--a-data); }

        .folder-icon-color.submitted {
          color: var(--gold-accent);
        }

        .folder-icon-color.pending {
          color: #706E6A;
        }

        .explorer-student-name {
          font-size: 13px;
          font-weight: 500;
          color: var(--t-hi);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .explorer-item-badges {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-shrink: 0;
        }

        .extra-pages-badge {
          background-color: rgba(197, 168, 128, 0.1);
          border: 1px solid rgba(197, 168, 128, 0.2);
          color: var(--gold-accent);
          font-size: 9px;
          font-weight: 600;
          text-transform: uppercase;
          padding: 2px 6px;
          border-radius: 4px;
        }

        .explorer-row-content {
          border-top: 1px solid #262423;
          background-color: #0F0E0D;
          padding: 20px;
          animation: fadeIn 0.2s ease-out;
        }

        .dossier-inner-grid {
          display: grid;
          grid-template-columns: 1.2fr 1fr;
          gap: 32px;
        }

        @media (max-width: 800px) {
          .dossier-inner-grid {
            grid-template-columns: 1fr;
            gap: 20px;
          }
        }

        .dossier-section-title {
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #706E6A;
          margin-bottom: 12px;
          font-weight: 600;
          border-bottom: 1px solid #262423;
          padding-bottom: 4px;
        }

        .dossier-meta-item {
          display: flex;
          font-size: 13px;
          gap: 8px;
          color: #A3A09B;
          margin-bottom: 10px;
        }

        .meta-label {
          color: #706E6A;
          font-weight: 500;
        }

        .dossier-meta-text-block {
          background-color: #161514;
          border: 1px solid #22201F;
          padding: 12px;
          border-radius: 4px;
          font-size: 13px;
        }

        .citat-p-explore {
          font-family: var(--font-sans);
          font-style: italic;
          color: #FAF9F6;
          margin-top: 4px;
        }

        .observatii-p-explore {
          color: #FAF9F6;
          margin-top: 4px;
        }

        .dossier-files-pane {
          display: flex;
          flex-direction: column;
        }

        .dossier-files-list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-height: 240px;
          overflow-y: auto;
        }

        .dossier-file-item {
          display: flex;
          align-items: center;
          gap: 10px;
          background-color: #161514;
          border: 1px solid #22201F;
          padding: 6px 12px;
          border-radius: 4px;
          font-size: 12px;
        }

        .dossier-file-item.extra-file {
          background-color: rgba(197, 168, 128, 0.02);
          border-color: rgba(197, 168, 128, 0.1);
        }

        .file-icon-type {
          color: #706E6A;
        }

        .dossier-file-details {
          flex: 1;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          overflow: hidden;
        }

        .file-category {
          color: #706E6A;
          font-weight: 500;
        }

        .file-name-text {
          flex: 1;
          color: #FAF9F6;
          font-family: monospace;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .badge-bw-inline {
          font-size: 9px;
          padding: 1px 6px;
          border-radius: 3px;
          font-weight: 600;
        }

        .badge-bw-inline.bw {
          background-color: #000000;
          color: #FFFFFF;
          border: 1px solid #3E3B39;
        }

        .badge-bw-inline.color {
          background-color: rgba(95, 11, 2, 0.25);
          color: #D8D0C8;
        }

        .dossier-empty-message {
          display: flex;
          align-items: center;
          color: #706E6A;
          font-size: 13px;
          padding: 12px;
          background-color: #161514;
          border: 1px dashed #262423;
          border-radius: 6px;
        }

        /* Logs Table Section */
        .table-responsive {
          width: 100%;
          overflow-x: auto;
          background-color: #161514;
          border: 1px solid #262423;
          border-radius: 8px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.15);
        }

        .logs-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
          font-size: 14px;
        }

        .logs-table th, .logs-table td {
          padding: 16px 24px;
          border-bottom: 1px solid #262423;
        }

        .logs-table th {
          background-color: #1C1A19;
          font-weight: 600;
          color: #A3A09B;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .logs-table tr:last-child td {
          border-bottom: none;
        }

        .logs-table tr:hover td {
          background-color: #1C1A19;
        }

        .semibold-cell {
          font-weight: 500;
          color: #FAF9F6;
        }

        .email-cell {
          color: var(--gold-accent);
          font-family: monospace;
        }

        .download-type-badge {
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 600;
        }

        .download-type-badge.zip {
          background-color: rgba(197, 168, 128, 0.15);
          color: var(--gold-accent);
        }

        .download-type-badge.single {
          background-color: #2D2A28;
          color: #FAF9F6;
        }

        .files-cell {
          color: #A3A09B;
        }

        .inline-icon {
          vertical-align: middle;
          margin-right: 4px;
        }

        /* Loading & Empty States */
        .dashboard-loading, .dashboard-error {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 80px 24px;
          gap: 16px;
          color: #A3A09B;
          text-align: center;
        }

        .dashboard-error h3 {
          font-size: 22px;
          color: #FAF9F6;
          font-weight: 500;
        }

        .error-desc {
          color: #E06C75;
          font-family: monospace;
          background-color: rgba(224, 108, 117, 0.05);
          padding: 8px 16px;
          border: 1px dashed rgba(224, 108, 117, 0.2);
          border-radius: 4px;
          font-size: 13px;
          max-width: 500px;
        }

        .error-help {
          font-size: 13px;
          color: #706E6A;
          max-width: 400px;
          margin-bottom: 8px;
        }

        /* Admin Modals */
        .admin-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background-color: rgba(14, 13, 12, 0.85);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
        }

        .admin-modal-card {
          background-color: #161514;
          border: 1px solid #262423;
          border-radius: 8px;
          width: 100%;
          max-width: 580px;
          max-height: 85vh;
          display: flex;
          flex-direction: column;
          box-shadow: 0 20px 50px rgba(0,0,0,0.5);
          overflow: hidden;
        }

        .admin-modal-card.details-view-card {
          max-width: 800px;
        }

        .admin-modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 20px 24px;
          border-bottom: 1px solid #262423;
          background-color: #1C1A19;
        }

        .admin-modal-header h3 {
          font-size: 18px;
          font-weight: 500;
          color: #FAF9F6;
        }

        .admin-modal-subtitle {
          font-size: 12px;
          color: #A3A09B;
        }

        .admin-modal-close {
          background: none;
          border: none;
          color: #706E6A;
          cursor: pointer;
          transition: color 0.15s;
        }

        .admin-modal-close:hover {
          color: #FAF9F6;
        }

        .search-bar-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }

        .search-icon-admin {
          position: absolute;
          color: #706E6A;
          pointer-events: none;
        }

        .search-input-admin {
          width: 100%;
          padding: 10px 16px 10px 40px;
          background-color: #0E0D0C;
          border: 1px solid #262423;
          border-radius: 4px;
          color: #FAF9F6;
          font-size: 13px;
          outline: none;
          transition: border-color 0.2s;
        }

        .search-input-admin:focus {
          border-color: var(--gold-accent);
        }

        .sub-status-badge {
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          padding: 2px 8px;
          border-radius: 4px;
        }

        .sub-status-badge.submitted {
          background-color: rgba(95, 11, 2, 0.25);
          color: #D8D0C8;
        }

        .sub-status-badge.pending {
          background-color: rgba(112, 110, 106, 0.15);
          color: #A3A09B;
        }

        .admin-modal-footer {
          padding: 16px 24px;
          border-top: 1px solid #262423;
          display: flex;
          justify-content: flex-end;
          background-color: #1C1A19;
        }

        /* Detail viewer styles */
        .submission-scroll-details {
          flex: 1;
          overflow-y: auto;
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 24px;
          background-color: #0E0D0C;
        }

        .details-section h4 {
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #A3A09B;
          margin-bottom: 12px;
          font-weight: 600;
          border-left: 2px solid var(--gold-accent);
          padding-left: 8px;
        }

        .detail-photos-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }

        .detail-photo-card {
          background-color: #161514;
          border: 1px solid #262423;
          padding: 12px;
          border-radius: 6px;
          display: flex;
          flex-direction: column;
          align-items: center;
          position: relative;
        }

        .detail-photo-card img {
          width: 100%;
          height: 180px;
          object-fit: cover;
          border-radius: 4px;
        }

        .detail-photo-card img.grayscale,
        .detail-grid-card img.grayscale {
          filter: grayscale(100%);
        }

        .photo-type-label {
          font-size: 11px;
          text-transform: uppercase;
          color: #706E6A;
          margin-bottom: 6px;
          font-weight: 500;
        }

        .bw-overlay-badge {
          position: absolute;
          top: 36px;
          right: 20px;
          background-color: #000000;
          color: #FFFFFF;
          font-size: 9px;
          font-weight: 600;
          padding: 2px 6px;
          border-radius: 4px;
        }

        .detail-photo-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
          gap: 16px;
        }

        .detail-grid-card {
          position: relative;
          aspect-ratio: 3/4;
          background-color: #161514;
          border: 1px solid #262423;
          border-radius: 6px;
          padding: 6px;
          display: flex;
          flex-direction: column;
        }

        .detail-grid-card img {
          width: 100%;
          flex: 1;
          object-fit: cover;
          border-radius: 4px;
        }

        .bw-overlay-badge-small {
          position: absolute;
          top: 12px;
          right: 12px;
          background-color: #000000;
          color: #FFFFFF;
          font-size: 8px;
          font-weight: 600;
          padding: 1px 4px;
          border-radius: 3px;
        }

        .detail-filename-label {
          display: block;
          font-size: 10px;
          font-family: monospace;
          color: #706E6A;
          margin-top: 6px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          width: 100%;
          text-align: center;
        }

        .detail-photo-card .detail-filename-label {
          margin-top: 8px;
        }

        .admin-text-box {
          background-color: #161514;
          border: 1px solid #262423;
          padding: 16px;
          border-radius: 6px;
        }

        .quote-text-admin {
          font-family: var(--font-sans);
          font-style: italic;
          color: #FAF9F6;
          font-size: 15px;
          margin-top: 4px;
        }

        .notes-text-admin {
          font-size: 13px;
          color: #FAF9F6;
          margin-top: 4px;
        }

        .spinner {
          animation: spin 1s linear infinite;
          color: var(--gold-accent);
        }

        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 80px 40px;
          text-align: center;
          background-color: #161514;
          border: 1px dashed #262423;
          border-radius: 8px;
          width: 100%;
        }

        .empty-icon {
          color: #706E6A;
          margin-bottom: 16px;
        }

        .empty-state h3 {
          font-size: 20px;
          font-weight: 400;
          margin-bottom: 8px;
          color: #FAF9F6;
        }

        .empty-state p {
          color: #A3A09B;
          font-size: 14px;
          max-width: 400px;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .directory-view {
          animation: fadeIn 0.3s ease;
        }
      `}</style>
      {/* Checklist Modal */}
      {activeChecklistModal && (
        <ChecklistModal
          title={activeChecklistModal.title}
          subtitle={activeChecklistModal.subtitle}
          items={activeChecklistModal.items}
          onClose={() => setActiveChecklistModal(null)}
          onSave={async (updatedItems) => {
            const { type, id } = activeChecklistModal;
            if (type === 'class') {
              await updateDoc(doc(db, 'classes', id), { checklist: updatedItems });
              setClasses(prev => prev.map(c => c.id === id ? { ...c, checklist: updatedItems } : c));
            } else if (type === 'gallery') {
              await updateDoc(doc(db, 'photo_galleries', id), { checklist: updatedItems });
              setPhotoGalleries(prev => prev.map(g => g.id === id ? { ...g, checklist: updatedItems } : g));
            }
            setActiveChecklistModal(prev => prev ? { ...prev, items: updatedItems } : null);
          }}
        />
      )}

      {/* ── Floating background upload bar for class photo uploads ── */}
      {(() => {
        const visibleJobs = Object.values(classUploadJobs).filter(j => j.filesTotal > 0);
        if (visibleJobs.length === 0) return null;
        const anyActive = visibleJobs.some(j => !j.isFinished);
        return (
          <div
            style={{
              position: 'fixed', bottom: '24px', right: '24px',
              width: '360px', display: 'flex', flexDirection: 'column',
              gap: '8px', zIndex: 99999, fontFamily: 'Outfit, sans-serif',
              maxHeight: '80vh', overflowY: 'auto', paddingRight: '2px',
            }}
            className="hide-scrollbar"
          >
            {visibleJobs.length > 1 && (
              <div style={{ backgroundColor: '#161514', border: '1px solid #2D2A28', borderRadius: '8px', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '10px', boxShadow: '0 4px 16px rgba(0,0,0,0.5)', color: '#FAF9F6' }}>
                {anyActive
                  ? <RefreshCw size={14} className="spinner" style={{ color: '#D4AF37', flexShrink: 0 }} />
                  : <Check size={14} style={{ color: '#2ECC71', flexShrink: 0 }} />
                }
                <span style={{ fontSize: '12px', fontWeight: 600 }}>
                  {visibleJobs.length} {anyActive ? 'încărcări în desfășurare' : 'încărcări finalizate'}
                </span>
              </div>
            )}

            {visibleJobs.map(job => {
              const percent = job.filesTotal > 0 ? Math.round((job.filesUploaded / job.filesTotal) * 100) : 0;
              const isExpanded = expandedUploadJob === job.classId;
              const items = Object.values(job.progressMap);
              return (
                <div
                  key={job.classId}
                  style={{
                    backgroundColor: '#161514', border: '1px solid #2D2A28',
                    borderRadius: '8px', boxShadow: '0 8px 30px rgba(0,0,0,0.6)',
                    color: '#FAF9F6', overflow: 'hidden',
                    transition: 'max-height 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                    maxHeight: isExpanded ? '340px' : '76px',
                    display: 'flex', flexDirection: 'column',
                  }}
                >
                  <div
                    style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: isExpanded ? '1px solid #2D2A28' : '1px solid transparent', cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => setExpandedUploadJob(isExpanded ? null : job.classId)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
                      {job.isFinished
                        ? <div style={{ width: '26px', height: '26px', borderRadius: '50%', backgroundColor: '#2ECC71', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Check size={13} style={{ color: '#121110' }} /></div>
                        : <div style={{ width: '26px', height: '26px', borderRadius: '50%', backgroundColor: '#D4AF37', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><RefreshCw size={13} className="spinner" style={{ color: '#121110' }} /></div>
                      }
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <h4 style={{ margin: 0, fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {job.isFinished ? 'Finalizat' : 'Se încarcă'}
                        </h4>
                        <p style={{ margin: '2px 0 0 0', fontSize: '11px', color: '#A3A09B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {job.className} · {job.filesUploaded}/{job.filesTotal} fișiere ({percent}%)
                        </p>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={e => e.stopPropagation()}>
                      <button onClick={() => setExpandedUploadJob(isExpanded ? null : job.classId)} style={{ background: 'none', border: 'none', color: '#706E6A', cursor: 'pointer', padding: '4px' }}>
                        {isExpanded ? <ChevronDown size={16} /> : <RefreshCw size={14} style={{ transform: 'none' }} />}
                      </button>
                      {job.isFinished && (
                        <button
                          onClick={() => setClassUploadJobs(prev => { const copy = { ...prev }; delete copy[job.classId]; return copy; })}
                          style={{ background: 'none', border: 'none', color: '#706E6A', cursor: 'pointer', padding: '4px' }}
                          title="Închide"
                        >
                          <X size={16} />
                        </button>
                      )}
                    </div>
                  </div>

                  {!isExpanded && !job.isFinished && (
                    <div style={{ width: '100%', height: '3px', backgroundColor: '#2D2A28' }}>
                      <div style={{ width: `${percent}%`, height: '100%', backgroundColor: '#D4AF37', transition: 'width 0.3s ease' }} />
                    </div>
                  )}

                  <div style={{ flex: 1, overflowY: 'auto', padding: isExpanded ? '10px 16px' : '0', display: isExpanded ? 'flex' : 'none', flexDirection: 'column', gap: '8px' }} className="hide-scrollbar">
                    {items.map(item => (
                      <div key={item.name} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                          <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '68%', color: '#E5DFD9' }}>{item.name}</span>
                          <span style={{ fontSize: '10px', color: item.status === 'Finalizat' ? '#2ECC71' : item.status === 'Eroare' ? '#E06C75' : '#D4AF37' }}>{item.status}</span>
                        </div>
                        {item.status !== 'Finalizat' && item.status !== 'Eroare' && (
                          <div style={{ width: '100%', height: '2px', backgroundColor: '#2D2A28', borderRadius: '1px', overflow: 'hidden' }}>
                            <div style={{ width: `${item.progress}%`, height: '100%', backgroundColor: '#D4AF37', transition: 'width 0.2s' }} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            <style>{`
              @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
              .spinner { animation: spin 1s linear infinite; }
            `}</style>
          </div>
        );
      })()}
      {/* Modal Editare Prețuri & Limite Clasă */}
      {showEditClassParamsModal && selectedClass && (
        <div className="modal-overlay" style={{ zIndex: 10000, backgroundColor: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}>
          <div className="modal-content hide-scrollbar" style={{ maxWidth: '520px', width: '90%', maxHeight: '90vh', overflowY: 'auto', backgroundColor: '#161514', border: '1px solid #3D3834', borderRadius: '12px', padding: '24px', color: '#FAF9F6', boxShadow: '0 20px 50px rgba(0,0,0,0.8)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid #2D2A28', paddingBottom: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '18px', color: 'var(--gold-accent)', fontWeight: 600 }}>
                Editează Prețurile & Limitele Clasei
              </h3>
              <button onClick={() => setShowEditClassParamsModal(false)} style={{ background: 'none', border: 'none', color: '#A3A09B', cursor: 'pointer', padding: '4px' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Preț Album Mare & Mic */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label className="form-label" style={{ fontSize: '12px', marginBottom: '4px', display: 'block', color: '#A3A09B' }}>
                    Preț Album Mare (LEI)
                  </label>
                  <input 
                    type="number" 
                    value={editPriceAlbumMare} 
                    onChange={(e) => setEditPriceAlbumMare(Math.max(0, parseInt(e.target.value) || 0))}
                    className="form-input"
                    style={{ backgroundColor: '#1C1A19', color: '#FAF9F6', border: '1px solid #2D2A28', padding: '8px 12px', borderRadius: '6px', width: '100%' }}
                  />
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: '12px', marginBottom: '4px', display: 'block', color: '#A3A09B' }}>
                    Preț Album Mic (LEI)
                  </label>
                  <input 
                    type="number" 
                    value={editPriceAlbumMic} 
                    onChange={(e) => setEditPriceAlbumMic(Math.max(0, parseInt(e.target.value) || 0))}
                    className="form-input"
                    style={{ backgroundColor: '#1C1A19', color: '#FAF9F6', border: '1px solid #2D2A28', padding: '8px 12px', borderRadius: '6px', width: '100%' }}
                  />
                </div>
              </div>

              {/* Preț Sonet & Pagină Extra */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label className="form-label" style={{ fontSize: '12px', marginBottom: '4px', display: 'block', color: '#A3A09B' }}>
                    Preț Sonet (LEI)
                  </label>
                  <input 
                    type="number" 
                    value={editPriceSonet} 
                    onChange={(e) => setEditPriceSonet(Math.max(0, parseInt(e.target.value) || 0))}
                    className="form-input"
                    style={{ backgroundColor: '#1C1A19', color: '#FAF9F6', border: '1px solid #2D2A28', padding: '8px 12px', borderRadius: '6px', width: '100%' }}
                  />
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: '12px', marginBottom: '4px', display: 'block', color: '#A3A09B' }}>
                    Preț Pagină Extra (LEI)
                  </label>
                  <input 
                    type="number" 
                    value={editExtraPagesPrice} 
                    onChange={(e) => setEditExtraPagesPrice(Math.max(0, parseInt(e.target.value) || 0))}
                    className="form-input"
                    style={{ backgroundColor: '#1C1A19', color: '#FAF9F6', border: '1px solid #2D2A28', padding: '8px 12px', borderRadius: '6px', width: '100%' }}
                  />
                </div>
              </div>

              {/* Limite Poze Personale */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label className="form-label" style={{ fontSize: '12px', marginBottom: '4px', display: 'block', color: '#A3A09B' }}>
                    Minim Poze Personale
                  </label>
                  <input 
                    type="number" 
                    value={editMinPhotos} 
                    onChange={(e) => setEditMinPhotos(Math.max(1, parseInt(e.target.value) || 1))}
                    className="form-input"
                    min="1"
                    style={{ backgroundColor: '#1C1A19', color: '#FAF9F6', border: '1px solid #2D2A28', padding: '8px 12px', borderRadius: '6px', width: '100%' }}
                  />
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: '12px', marginBottom: '4px', display: 'block', color: '#A3A09B' }}>
                    Maxim Poze Personale
                  </label>
                  <input 
                    type="number" 
                    value={editMaxPhotos} 
                    onChange={(e) => setEditMaxPhotos(Math.max(editMinPhotos, parseInt(e.target.value) || editMinPhotos))}
                    className="form-input"
                    min={editMinPhotos}
                    style={{ backgroundColor: '#1C1A19', color: '#FAF9F6', border: '1px solid #2D2A28', padding: '8px 12px', borderRadius: '6px', width: '100%' }}
                  />
                </div>
              </div>

              {/* Opțiuni Excel: Folder Separat & Coșuri Scoase */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label className="form-label" style={{ fontSize: '12px', marginBottom: '4px', display: 'block', color: '#A3A09B' }}>
                    Preț Folder Separat (LEI / elev)
                  </label>
                  <input 
                    type="number" 
                    value={editFolderSeparatPrice} 
                    onChange={(e) => setEditFolderSeparatPrice(Math.max(0, parseInt(e.target.value) || 0))}
                    className="form-input"
                    style={{ backgroundColor: '#1C1A19', color: '#FAF9F6', border: '1px solid #2D2A28', padding: '8px 12px', borderRadius: '6px', width: '100%' }}
                  />
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: '12px', marginBottom: '4px', display: 'block', color: '#A3A09B' }}>
                    Preț Coșuri Scoase (LEI / elev)
                  </label>
                  <input 
                    type="number" 
                    value={editCosuriScoasePrice} 
                    onChange={(e) => setEditCosuriScoasePrice(Math.max(0, parseInt(e.target.value) || 0))}
                    className="form-input"
                    style={{ backgroundColor: '#1C1A19', color: '#FAF9F6', border: '1px solid #2D2A28', padding: '8px 12px', borderRadius: '6px', width: '100%' }}
                  />
                </div>
              </div>

              {/* Plăți Extra per Clasă */}
              <div>
                <label className="form-label" style={{ fontSize: '12px', marginBottom: '4px', display: 'block', color: '#A3A09B' }}>
                  Plăți Extra per Clasă (Transport, Întârzieri etc.)
                </label>
                <input 
                  type="number" 
                  value={editExtraClassPayment} 
                  onChange={(e) => setEditExtraClassPayment(Math.max(0, parseInt(e.target.value) || 0))}
                  className="form-input"
                  style={{ backgroundColor: '#1C1A19', color: '#FAF9F6', border: '1px solid #2D2A28', padding: '8px 12px', borderRadius: '6px', width: '100%' }}
                />
              </div>

              {/* Persoane Speciale / Diriginți */}
              <div style={{ backgroundColor: '#1C1A19', border: '1px solid #2D2A28', borderRadius: '8px', padding: '14px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gold-accent)', display: 'block', marginBottom: '8px' }}>
                  Diriginți & Persoane Speciale (Excel)
                </span>
                <p style={{ margin: '0 0 10px 0', fontSize: '11px', color: '#A3A09B' }}>
                  Adaugă persoane speciale (ex: Diriginte) cu preț customizat pt album (0 LEI sau alt preț).
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px auto', gap: '8px', marginBottom: '12px' }}>
                  <input 
                    type="text" 
                    placeholder="Nume (ex: Diriginte Popescu)" 
                    value={newPersonName} 
                    onChange={(e) => setNewPersonName(e.target.value)} 
                    className="form-input" 
                    style={{ backgroundColor: '#161514', color: '#FAF9F6', border: '1px solid #2D2A28', padding: '6px 10px', borderRadius: '4px', fontSize: '12px' }}
                  />
                  <input 
                    type="number" 
                    placeholder="Preț LEI" 
                    value={newPersonPrice} 
                    onChange={(e) => setNewPersonPrice(Math.max(0, parseInt(e.target.value) || 0))} 
                    className="form-input" 
                    style={{ backgroundColor: '#161514', color: '#FAF9F6', border: '1px solid #2D2A28', padding: '6px 10px', borderRadius: '4px', fontSize: '12px' }}
                  />
                  <button 
                    type="button" 
                    onClick={handleAddSpecialPerson}
                    style={{ backgroundColor: 'var(--gold-accent)', border: 'none', color: '#121110', padding: '6px 12px', borderRadius: '4px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                  >
                    + Adaugă
                  </button>
                </div>

                {editSpecialPersons.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {editSpecialPersons.map((p) => (
                      <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#161514', padding: '6px 10px', borderRadius: '4px', fontSize: '12px', border: '1px solid #2D2A28' }}>
                        <span><strong>{p.name}</strong> — Preț Album: <span style={{ color: 'var(--gold-accent)' }}>{p.albumPrice} LEI</span></span>
                        <button 
                          type="button" 
                          onClick={() => handleRemoveSpecialPerson(p.id)}
                          style={{ background: 'none', border: 'none', color: '#FF6B6B', cursor: 'pointer', padding: '2px 6px', fontSize: '11px' }}
                        >
                          Șterge
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span style={{ fontSize: '11px', color: '#706E6A', fontStyle: 'italic' }}>Nicio persoană specială adăugată.</span>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px', paddingTop: '16px', borderTop: '1px solid #2D2A28' }}>
              <button 
                onClick={() => setShowEditClassParamsModal(false)}
                style={{ backgroundColor: 'transparent', border: '1px solid #3D3834', color: '#FAF9F6', padding: '8px 16px', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' }}
              >
                Renunță
              </button>
              <button 
                onClick={handleSaveClassParams}
                style={{ backgroundColor: 'var(--gold-accent)', border: 'none', color: '#121110', padding: '8px 20px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
              >
                Salvează Modificările
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
};
